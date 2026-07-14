/**
 * The settle transaction: idempotency (I3), the commit-vs-settle race (I2 +
 * anti-sniping), void handling, insurance flow, economy application.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, TEST_DAY, type TestEnv } from './helpers/env';
import { commitsWithCounts, loadCommits } from './helpers/synth';
import { openRound } from '../src/server/core/rounds';
import { sealedCommit } from '../src/server/core/commits';
import { settleRound, reckoningText } from '../src/server/core/settle';
import { K, OUTCOME_SUMMARY_FIELD, outcomeUserField } from '../src/server/core/keys';
import { DAY_MS } from '../src/server/core/time';
import { defaultParams } from '../src/shared/payoffs';
import type { OutcomeSummaryView, MyResultView } from '../src/shared/api';

const DAY = TEST_DAY;

async function openTestRound(env: TestEnv, day = DAY): Promise<void> {
  await openRound(env.deps, {
    day,
    archetype: 'public_pot',
    params: defaultParams('public_pot'),
    title: 'THE BLACKOUT POT',
    flavor: 'test',
    openedAt: day * DAY_MS,
    preseason: false,
  });
}

describe('settle — one idempotent watch/multi/exec pass', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('settles an open round and stores summary + per-user results', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 8, HOARD: 2 }));

    const result = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    expect(result.status).toBe('settled');

    const summaryRaw = await env.redis.hGet(K.outcome(DAY), OUTCOME_SUMMARY_FIELD);
    const summary = JSON.parse(summaryRaw!) as OutcomeSummaryView;
    expect(summary.split).toEqual({ FEED: 8, HOARD: 2 });
    expect(summary.groupOutcome).toBe('triumph');
    expect(summary.participants).toBe(10);

    const state = await env.redis.hGet(K.round(DAY), 'state');
    expect(state).toBe('settled');
    expect(await env.redis.get(K.settledLast)).toBe(String(DAY));
  });

  it('is idempotent: a second run is a no-op and the store is byte-identical', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 5, HOARD: 5 }));

    const first = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    expect(first.status).toBe('settled');
    const dumpAfterFirst = JSON.stringify(env.redis.dump());

    const second = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS + 999 });
    expect(second.status).toBe('already');
    expect(JSON.stringify(env.redis.dump())).toBe(dumpAfterFirst);

    // and a third time, via a different "now" — still untouched
    env.setNow((DAY + 2) * DAY_MS);
    const third = await settleRound(env.deps, DAY);
    expect(third.status).toBe('already');
    expect(JSON.stringify(env.redis.dump())).toBe(dumpAfterFirst);
  });

  it('void rounds never settle and never reveal', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 4 }));
    await env.redis.hSet(K.round(DAY), { state: 'void' });

    const result = await settleRound(env.deps, DAY);
    expect(result.status).toBe('void');
    expect(await env.redis.hGet(K.outcome(DAY), OUTCOME_SUMMARY_FIELD)).toBeUndefined();
  });

  it('settling a missing round reports no_round', async () => {
    const result = await settleRound(env.deps, 99999);
    expect(result.status).toBe('no_round');
  });

  it('a commit landing mid-settle forces a retry that INCLUDES the late commit', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 7, HOARD: 2 }));

    let injected = false;
    env.redis.pause = async () => {
      if (injected) return;
      injected = true;
      env.redis.pause = null; // the late commit's own tx must not re-enter
      const late = await sealedCommit(env.deps, {
        day: DAY,
        userId: 't2_late',
        username: 'late_larry',
        choice: 'FEED',
        stake: 10,
        buyInsurance: false,
      });
      expect(late.ok).toBe(true);
    };

    const result = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    expect(result.status).toBe('settled');
    expect(injected).toBe(true);
    if (result.status !== 'settled') throw new Error('unreachable');
    expect(result.summary.participants).toBe(10); // 9 + the late one
    const mineRaw = await env.redis.hGet(K.outcome(DAY), outcomeUserField('t2_late'));
    expect(mineRaw).toBeDefined();
  });

  it('a commit racing PAST the settle is rejected cleanly (envelope sealed)', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 6, HOARD: 1 }));

    let settled = false;
    env.redis.pause = async () => {
      if (settled) return;
      settled = true;
      env.redis.pause = null; // settle's own txs must run clean
      const s = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
      expect(s.status).toBe('settled');
    };

    // This commit passes its pre-checks while the round is open, but the
    // settle completes between its WATCH and EXEC → clean rejection.
    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_sniper',
      username: 'sniper_sue',
      choice: 'HOARD',
      stake: 20,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('round_sealed');
    expect(result.message).toContain('sealed');

    // and the sniper is NOT in the settled outcome
    expect(await env.redis.hGet(K.outcome(DAY), outcomeUserField('t2_sniper'))).toBeUndefined();
  });

  it('applies the economy: delta + participation reward, materialized balances', async () => {
    await openTestRound(env);
    const commits = commitsWithCounts({ FEED: 8, HOARD: 2 });
    await loadCommits(env.redis, DAY, commits);
    await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });

    const feeder = commits.find((c) => c.choice === 'FEED')!;
    const hoarder = commits.find((c) => c.choice === 'HOARD')!;
    const feederBalance = await env.redis.zScore(K.seasonPoints, feeder.username);
    const hoarderBalance = await env.redis.zScore(K.seasonPoints, hoarder.username);
    // start 100 + delta + reward 5
    expect(feederBalance).toBe(100 + feeder.stake + 5);
    expect(hoarderBalance).toBe(100 + 2 * hoarder.stake + 5);
  });

  it('consumes insurance on a loss and records insuranceSaved in my result', async () => {
    await openTestRound(env);
    // A burn: 3 feed / 7 hoard. u0 (FEED) holds insurance.
    const commits = commitsWithCounts({ FEED: 3, HOARD: 7 });
    await loadCommits(env.redis, DAY, commits);
    const insured = commits[0]!;
    await env.redis.hSet(K.streak(insured.userId), {
      current: '4',
      best: '4',
      insuranceHeld: '1',
      lastDay: String(DAY - 1),
    });

    await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });

    const mine = JSON.parse(
      (await env.redis.hGet(K.outcome(DAY), outcomeUserField(insured.userId)))!
    ) as MyResultView;
    expect(mine.outcomeClass).toBe('loss');
    expect(mine.insuranceSaved).toBe(true);
    expect(mine.streakAfter).toBe(4); // preserved

    const streak = await env.redis.hGetAll(K.streak(insured.userId));
    expect(streak['insuranceHeld']).toBe('0'); // consumed
    expect(streak['current']).toBe('4');

    // an uninsured loser resets
    const loser = commits[1]!;
    const loserStreak = await env.redis.hGetAll(K.streak(loser.userId));
    expect(loserStreak['current']).toBe('0');
  });

  it('names saints and serpents deterministically in the summary', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 6, HOARD: 2 }));
    const result = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    if (result.status !== 'settled') throw new Error('expected settled');
    expect(result.summary.saints.length).toBeGreaterThan(0);
    expect(result.summary.saints.length).toBeLessThanOrEqual(3);
    expect(result.summary.serpents.length).toBeGreaterThan(0); // hoarders won
    // deterministic: rerun the whole scenario in a fresh env
    const env2 = makeEnv();
    await openRound(env2.deps, {
      day: DAY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 'THE BLACKOUT POT',
      flavor: 'test',
      openedAt: DAY * DAY_MS,
      preseason: false,
    });
    await loadCommits(env2.redis, DAY, commitsWithCounts({ FEED: 6, HOARD: 2 }));
    const result2 = await settleRound(env2.deps, DAY, { at: (DAY + 1) * DAY_MS });
    if (result2.status !== 'settled') throw new Error('expected settled');
    expect(result2.summary).toEqual(result.summary);
  });

  it('clears the display pot counter after settling', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 4 }));
    expect(await env.redis.get(K.pot(DAY))).toBeDefined();
    await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    expect(await env.redis.get(K.pot(DAY))).toBeUndefined();
  });

  it('reports no_round for a corrupted round hash (unknown archetype)', async () => {
    await env.redis.hSet(K.round(DAY), {
      day: String(DAY),
      archetype: 'calvinball',
      state: 'open',
    });
    const result = await settleRound(env.deps, DAY);
    expect(result.status).toBe('no_round');
  });

  it('throws after exhausting every retry in a permanent conflict storm', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 4 }));
    // Every exec() bumps the watched round key first, so every attempt trips
    // its own WATCH — a permanent (not one-shot) race injector.
    env.redis.pause = async () => {
      await env.redis.hSet(K.round(DAY), { jitter: String(Math.random()) });
    };
    await expect(settleRound(env.deps, DAY)).rejects.toThrow(/conflict storm/);
  });

  it('skips a corrupted (non-JSON) entry sitting alongside valid sealed commits', async () => {
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 4 }));
    await env.redis.hSet(K.commit(DAY), { t2_corrupt: 'not-json-at-all' });
    const result = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    if (result.status !== 'settled') throw new Error('expected settled');
    expect(result.summary.participants).toBe(4); // the corrupt entry never counted
    expect(await env.redis.hGet(K.outcome(DAY), outcomeUserField('t2_corrupt'))).toBeUndefined();
  });

  it('saints/serpents summary sorting: a tie falls back to ascending username, even out of insertion order', async () => {
    // userId order (ascending, what commits.sort() uses) is t2_a < t2_b, but
    // their USERNAMES are in the opposite order — this is the only way to
    // exercise byDeltaThenName's alphabetic tie-break in the ": 1" direction.
    await openTestRound(env);
    await env.redis.hSet(K.commit(DAY), {
      t2_a: JSON.stringify({ choice: 'FEED', stake: 10, insured: false, username: 'zulu', ts: 0 }),
      t2_b: JSON.stringify({ choice: 'FEED', stake: 10, insured: false, username: 'alpha', ts: 0 }),
    });
    const result = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    if (result.status !== 'settled') throw new Error('expected settled');
    // both fed and won identically (tied saint delta) — alphabetic tie-break
    // must put 'alpha' ahead of 'zulu' regardless of userId processing order.
    expect(result.summary.saints).toEqual(['alpha', 'zulu']);
  });
});

describe('reckoningText', () => {
  it('lists both saints and serpents when both crowns are present', async () => {
    const env = makeEnv();
    await openTestRound(env);
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 6, HOARD: 2 }));
    const result = await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
    if (result.status !== 'settled') throw new Error('expected settled');
    const text = reckoningText(result.summary);
    expect(text).toContain('Saints of the night:');
    expect(text).toContain('Serpents of the night:');
  });

  it('omits the saints/serpents lines when nobody is crowned', () => {
    const text = reckoningText({
      day: DAY,
      title: 'THE VOID',
      flavor: '',
      archetype: 'public_pot',
      params: {},
      participants: 0,
      pot: 0,
      split: {},
      splitPct: {},
      groupOutcome: 'void',
      verdict: 'Nobody committed.',
      detail: '',
      saints: [],
      serpents: [],
      preseason: false,
      author: null,
      settledAt: 0,
    });
    expect(text).not.toContain('Saints of the night:');
    expect(text).not.toContain('Serpents of the night:');
  });
});
