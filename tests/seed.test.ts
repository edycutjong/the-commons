/**
 * Seed Preseason: the six labeled rounds land byte-deterministically, teach
 * the payoff space per SEED_DATA.md, and populate the consequence ladders.
 */

import { describe, expect, it } from 'vitest';
import { makeEnv, postJson, TEST_DAY } from './helpers/env';
import { seedPreseason, founderUserId, expandCommits } from '../src/server/core/seed';
import { K, outcomeUserField } from '../src/server/core/keys';
import type { HistoryResponse, RoundResponse, MyResultView } from '../src/shared/api';

describe('expandCommits', () => {
  it('is total: a round with neither commits nor generated fields expands to nothing', () => {
    const out = expandCommits(
      { offset: 0, roman: 'X', title: 't', flavor: 'f', archetype: 'public_pot', params: {} },
      1_000
    );
    expect(out.size).toBe(0);
  });
});

describe('seedPreseason — resetGameState resilience', () => {
  it('skips a corrupted (non-numeric) round:index entry without throwing', async () => {
    const env = makeEnv();
    await env.redis.zAdd(K.roundIndex, { member: 'not-a-number', score: 1 });
    await expect(seedPreseason(env.deps, TEST_DAY)).resolves.toBeDefined();
  });
});

describe('seed preseason', () => {
  it('is deterministic: two fresh seeds produce identical stores', async () => {
    const a = makeEnv();
    const b = makeEnv();
    await seedPreseason(a.deps, TEST_DAY);
    await seedPreseason(b.deps, TEST_DAY);
    expect(a.redis.dump()).toEqual(b.redis.dump());
  });

  it('is idempotent: re-seeding the same install restores the exact state', async () => {
    const env = makeEnv();
    await seedPreseason(env.deps, TEST_DAY);
    const first = JSON.stringify(env.redis.dump());
    // dirty the world a little, then re-seed
    await env.redis.zAdd(K.seasonPoints, { member: 'vandal', score: 9999 });
    await seedPreseason(env.deps, TEST_DAY);
    expect(JSON.stringify(env.redis.dump())).toBe(first);
  });

  it('teaches the payoff space: all six SEED_DATA beats present, newest first', async () => {
    const env = makeEnv();
    await postJson(env.app, '/internal/menu/seed-preseason');
    const history = (await (
      await env.app.request('/api/history')
    ).json()) as HistoryResponse;

    expect(history.entries).toHaveLength(6);
    const [vi, v, iv, iii, ii, i] = history.entries.map((e) => e.outcome) as [
      (typeof history.entries)[0]['outcome'],
      (typeof history.entries)[0]['outcome'],
      (typeof history.entries)[0]['outcome'],
      (typeof history.entries)[0]['outcome'],
      (typeof history.entries)[0]['outcome'],
      (typeof history.entries)[0]['outcome'],
    ];

    // I — clean cooperation win
    expect(i.title).toContain('THE FIRST FIRE');
    expect(i.groupOutcome).toBe('triumph');
    // II — the 58% catastrophe (the demo line, verbatim)
    expect(ii.verdict).toBe('58.0% hoarded. The pot burned.');
    expect(ii.participants).toBe(400);
    // III — the 69.4%-vs-70% knife edge
    expect(iii.title).toContain("KNIFE'S EDGE");
    expect(iii.splitPct['FEED']).toBe(69.4);
    expect(iii.groupOutcome).toBe('ruin');
    expect(iii.participants).toBe(500);
    // IV — stag hunt failure
    expect(iv.verdict).toContain('The hunt failed');
    // V — lowest-unique oddity: the quiet 3 takes it
    expect(v.verdict).toContain('BID 3');
    // VI — exact-N heist success
    expect(vi.verdict).toContain('The vault opened');
    expect(vi.splitPct['HEIST']).toBe(12.5);

    // every preseason round is labeled as such
    expect(history.entries.every((e) => e.outcome.preseason)).toBe(true);
  });

  it('opens tonight as a live, honest, zero-commit round', async () => {
    const env = makeEnv();
    await postJson(env.app, '/internal/menu/seed-preseason');
    const round = (await (await env.app.request('/api/round')).json()) as RoundResponse;
    expect(round.round!.title).toBe('THE BLACKOUT POT');
    expect(round.round!.state).toBe('open');
    expect(round.round!.participants).toBe(0);
    expect(round.round!.pot).toBe(0);
    expect(round.round!.preseason).toBe(false);
    expect(round.lastSettledDay).toBe(TEST_DAY - 1);
    // no Reddit posts are fabricated for preseason rounds
    expect(env.reddit.posts).toHaveLength(0);
  });

  it('populates the ladders: ash the saint, laurel the serpent, 500 souls banked', async () => {
    const env = makeEnv();
    await seedPreseason(env.deps, TEST_DAY);

    const topSaint = await env.redis.zRange(K.repSaint, 0, 0, { by: 'rank', reverse: true });
    expect(topSaint[0]).toEqual({ member: 'commons_founder_ash', score: 55 });

    const topSerpent = await env.redis.zRange(K.repSerpent, 0, 0, { by: 'rank', reverse: true });
    expect(topSerpent[0]).toEqual({ member: 'commons_founder_laurel', score: 25 });

    expect(await env.redis.zCard(K.seasonPoints)).toBe(500); // 12 named + 488 generated
    expect(await env.redis.zScore(K.repSaint, 'commons_founder_laurel')).toBeUndefined();
  });

  it('tells the insurance stories: fern saved at 1, birch saved at 0', async () => {
    const env = makeEnv();
    await seedPreseason(env.deps, TEST_DAY);

    const fern = JSON.parse(
      (await env.redis.hGet(K.outcome(TEST_DAY - 5), outcomeUserField(founderUserId('fern'))))!
    ) as MyResultView;
    expect(fern.outcomeClass).toBe('loss');
    expect(fern.insuranceSaved).toBe(true);
    expect(fern.streakAfter).toBe(1); // the LONG WINTER could not take it

    const birch = JSON.parse(
      (await env.redis.hGet(K.outcome(TEST_DAY - 4), outcomeUserField(founderUserId('birch'))))!
    ) as MyResultView;
    expect(birch.insuranceSaved).toBe(true);
    expect(birch.streakAfter).toBe(0); // saved a zero — the ledger is wry about it

    // laurel walked out of the vault with a fresh streak
    const laurelStreak = await env.redis.hGetAll(K.streak(founderUserId('laurel')));
    expect(laurelStreak['current']).toBe('1');
  });

  it('weekly ceremony crowns from the seeded ladders and decays them x0.8', async () => {
    const env = makeEnv();
    await postJson(env.app, '/internal/menu/seed-preseason');
    const res = await postJson(env.app, '/internal/cron/ceremony');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['saint']).toBe('commons_founder_ash');
    expect(body['serpent']).toBe('commons_founder_laurel');
    expect(body['wildcard']).toBeTruthy();

    // synthetic founders never receive real flair
    expect(env.reddit.flairSet).toHaveLength(0);

    // decay applied: 55 -> 44, 25 -> 20
    expect(await env.redis.zScore(K.repSaint, 'commons_founder_ash')).toBe(44);
    expect(await env.redis.zScore(K.repSerpent, 'commons_founder_laurel')).toBe(20);

    // ceremony result cached for the in-app crown chips
    expect(await env.redis.get(K.ceremonyLast)).toBeDefined();
  });
});
