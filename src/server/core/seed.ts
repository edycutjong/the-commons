/**
 * Seed Preseason — deterministic, idempotent, one tap.
 *
 * Loads the six labeled preseason rounds from data/fixtures/preseason.json,
 * settles each through the REAL settle transaction (same code path as the
 * midnight cron — the fixture is proof the engine is the data generator),
 * then opens tonight's live round with zero commits (honest counter).
 *
 * Reset-first semantics: seeding wipes every key the game owns and rebuilds
 * from the fixture, so "seed twice → identical outcome hashes" holds by
 * construction (asserted in tests/seed.test.ts).
 */

import fixtureJson from '../../../data/fixtures/preseason.json';
import type { Deps } from './deps';
import { K } from './keys';
import { openRound } from './rounds';
import { settleRound } from './settle';
import type { StoredCommit } from './commits';
import { DAY_MS } from './time';
import { serializeStreak, parseStreak, isArchetype, type Params } from '../../shared/payoffs';

type FixtureCommit = { user: string; choice: string; stake: number };
type FixtureRound = {
  offset: number;
  roman: string;
  title: string;
  flavor: string;
  archetype: string;
  params: Params;
  commits?: FixtureCommit[];
  generated?: { count: number; choices: Record<string, number> };
  insuranceFor?: string[];
  expect?: Record<string, unknown>;
};
type Fixture = {
  version: number;
  founders: string[];
  rounds: FixtureRound[];
  tonight: { title: string; flavor: string; archetype: string; params: Params };
};

export const FIXTURE: Fixture = fixtureJson as unknown as Fixture;

export const founderUserId = (name: string): string => `t2_cf_${name}`;
export const founderUsername = (name: string): string => `commons_founder_${name}`;
export const genName = (i: number): string => `gen_${String(i).padStart(3, '0')}`;
export const genStake = (i: number): number => 10 + (i % 4) * 10;

/** Expand one fixture round into (userId -> StoredCommit) pairs. Deterministic. */
export function expandCommits(round: FixtureRound, ts: number): Map<string, StoredCommit> {
  const out = new Map<string, StoredCommit>();
  for (const c of round.commits ?? []) {
    out.set(founderUserId(c.user), {
      choice: c.choice,
      stake: c.stake,
      insured: false,
      username: founderUsername(c.user),
      ts,
    });
  }
  if (round.generated) {
    let i = 1;
    for (const [choice, count] of Object.entries(round.generated.choices)) {
      for (let n = 0; n < count; n++, i++) {
        const name = genName(i);
        out.set(founderUserId(name), {
          choice,
          stake: genStake(i),
          insured: false,
          username: founderUsername(name),
          ts,
        });
      }
    }
  }
  return out;
}

export type SeedResult = {
  seededRounds: number;
  tonightDay: number;
  wipedDays: number;
};

export async function seedPreseason(deps: Deps, today: number): Promise<SeedResult> {
  const wipedDays = await resetGameState(deps);

  for (const round of [...FIXTURE.rounds].sort((a, b) => a.offset - b.offset)) {
    /* v8 ignore next -- every FIXTURE.rounds archetype is a real built-in archetype (shipped, validated fixture); this defensive guard cannot fire from the actual data */
    if (!isArchetype(round.archetype)) throw new Error(`fixture archetype: ${round.archetype}`);
    const day = today + round.offset;
    const openedAt = day * DAY_MS + 5 * 60_000;
    const commitTs = day * DAY_MS + 6 * 3_600_000;

    await openRound(deps, {
      day,
      archetype: round.archetype,
      params: round.params,
      title: round.title,
      flavor: round.flavor,
      author: null,
      postId: null,
      openedAt,
      preseason: true,
    });

    const commits = expandCommits(round, commitTs);
    const fields: Record<string, string> = {};
    let pot = 0;
    for (const [userId, commit] of commits) {
      fields[userId] = JSON.stringify(commit);
      pot += commit.stake;
    }
    if (Object.keys(fields).length > 0) {
      await deps.redis.hSet(K.commit(day), fields);
      await deps.redis.incrBy(K.pot(day), pot);
    }

    // Insurance held going into this night (purchased "earlier" in the story).
    /* v8 ignore next -- every FIXTURE.rounds entry always defines insuranceFor (as [] when unused), so the ?? [] fallback never fires from the shipped fixture */
    for (const name of round.insuranceFor ?? []) {
      const userId = founderUserId(name);
      const prev = parseStreak(await deps.redis.hGetAll(K.streak(userId)));
      await deps.redis.hSet(K.streak(userId), serializeStreak({ ...prev, insuranceHeld: 1 }));
      const stored = commits.get(userId);
      if (stored) {
        await deps.redis.hSet(K.commit(day), {
          [userId]: JSON.stringify({ ...stored, insured: true }),
        });
      }
    }

    // Same idempotent settle pass as the midnight cron; timestamp pinned to
    // the round's own midnight so seeding is byte-deterministic.
    await settleRound(deps, day, { at: (day + 1) * DAY_MS });
  }

  // Tonight's live round — open, zero commits, honest counter.
  const tonight = FIXTURE.tonight;
  /* v8 ignore next -- FIXTURE.tonight.archetype is a real built-in archetype (shipped, validated fixture); this defensive guard cannot fire from the actual data */
  if (!isArchetype(tonight.archetype)) throw new Error('fixture tonight archetype');
  await openRound(deps, {
    day: today,
    archetype: tonight.archetype,
    params: tonight.params,
    title: tonight.title,
    flavor: tonight.flavor,
    author: null,
    postId: null,
    openedAt: today * DAY_MS + 5 * 60_000,
    preseason: false,
  });

  return { seededRounds: FIXTURE.rounds.length, tonightDay: today, wipedDays };
}

/** Wipe every key the game owns (enumerable via round:index + fixed keys). */
async function resetGameState(deps: Deps): Promise<number> {
  const days = await deps.redis.zRange(K.roundIndex, 0, -1, { by: 'rank' });
  let wiped = 0;
  for (const { member } of days) {
    const day = Number.parseInt(member, 10);
    if (Number.isNaN(day)) continue;
    const userIds = await deps.redis.hKeys(K.commit(day));
    for (let i = 0; i < userIds.length; i += 100) {
      const chunk = userIds.slice(i, i + 100).map((id) => K.streak(id));
      if (chunk.length > 0) await deps.redis.del(...chunk);
    }
    await deps.redis.del(K.round(day), K.commit(day), K.outcome(day), K.pot(day));
    wiped++;
  }
  await deps.redis.del(
    K.roundIndex,
    K.roundCurrent,
    K.repSaint,
    K.repSerpent,
    K.seasonPoints,
    K.forgeQueue,
    K.forgeApproved,
    K.settledLast,
    K.ceremonyLast
  );
  return wiped;
}
