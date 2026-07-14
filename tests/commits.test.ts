/**
 * sealedCommit edge cases not already reached through endpoints.test.ts /
 * settle.test.ts: bad stakes, insufficient points, the conflict-retry storm,
 * the post-WATCH TOCTOU round-sealed check, and the two distinct commit-vs-
 * commit races (a re-checked-still-open 'conflict' vs. a genuine
 * already_committed collision via a tripped HSETNX).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, TEST_DAY, type TestEnv } from './helpers/env';
import { openRound } from '../src/server/core/rounds';
import { sealedCommit, parseStoredCommit } from '../src/server/core/commits';
import { K } from '../src/server/core/keys';
import { DAY_MS } from '../src/server/core/time';
import { defaultParams } from '../src/shared/payoffs';

const DAY = TEST_DAY;

async function openTestRound(env: TestEnv): Promise<void> {
  await openRound(env.deps, {
    day: DAY,
    archetype: 'public_pot',
    params: defaultParams('public_pot'),
    title: 'THE BLACKOUT POT',
    flavor: 'test',
    openedAt: DAY * DAY_MS,
    preseason: false,
  });
}

describe('sealedCommit — no round open at all (direct call)', () => {
  it('reports no_round when the day has never been opened', async () => {
    const env = makeEnv();
    const result = await sealedCommit(env.deps, {
      day: 999_999,
      userId: 't2_a',
      username: 'user_a',
      choice: 'FEED',
      stake: 5,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('no_round');
  });
});

describe('sealedCommit — edge cases', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = makeEnv();
    await openTestRound(env);
  });

  it('rejects a negative stake as bad_stake', async () => {
    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_a',
      username: 'user_a',
      choice: 'FEED',
      stake: -5,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('bad_stake');
  });

  it('reports insufficient_points when the balance is already zero', async () => {
    await env.redis.zAdd(K.seasonPoints, { member: 'user_broke', score: 0 });
    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_broke',
      username: 'user_broke',
      choice: 'FEED',
      stake: 5,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('insufficient_points');
  });

  it('gives a clean round_sealed after exhausting every retry in a conflict storm', async () => {
    // Every exec() bumps the watched round key first, so every attempt's own
    // WATCH trips against itself — a permanent, not one-shot, race injector.
    env.redis.pause = async () => {
      await env.redis.hSet(K.round(DAY), { jitter: String(Math.random()) });
    };
    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_storm',
      username: 'user_storm',
      choice: 'FEED',
      stake: 5,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('round_sealed');
    expect(result.message).toContain('sealed');
  });

  it('cleanly rejects a commit whose round flips to non-open right after WATCH is armed', async () => {
    const originalWatch = env.redis.watch.bind(env.redis);
    env.redis.watch = (async (...keys: string[]) => {
      const tx = await originalWatch(...keys);
      // Flip AFTER the watch snapshot but BEFORE the code's own re-check read.
      await env.redis.hSet(K.round(DAY), { state: 'settled' });
      return tx;
    }) as typeof env.redis.watch;

    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_toctou',
      username: 'user_toctou',
      choice: 'FEED',
      stake: 5,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('round_sealed');
  });

  it('retries cleanly through a conflict where the round is still open on re-check (insured race)', async () => {
    let injected = false;
    env.redis.pause = async () => {
      if (injected) return;
      injected = true;
      env.redis.pause = null; // the racing commit's own tx must not re-enter
      const race = await sealedCommit(env.deps, {
        day: DAY,
        userId: 't2_other',
        username: 'other_o',
        choice: 'FEED',
        stake: 5,
        buyInsurance: true,
      });
      expect(race.ok).toBe(true);
    };

    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_first',
      username: 'first_f',
      choice: 'FEED',
      stake: 5,
      buyInsurance: true,
    });
    expect(result.ok).toBe(true); // succeeded after an internal conflict retry
    expect(injected).toBe(true);
  });

  it('reports already_committed when a same-user double-tap lands between WATCH and EXEC', async () => {
    let injected = false;
    env.redis.pause = async () => {
      if (injected) return;
      injected = true;
      env.redis.pause = null;
      // A second, identical-user commit completes fully while the first's tx
      // is paused inside its own exec() — the first's un-watched hSetNX then
      // finds the field already written and reports 0 (not 1).
      const other = await sealedCommit(env.deps, {
        day: DAY,
        userId: 't2_dup',
        username: 'dup_user',
        choice: 'FEED',
        stake: 5,
        buyInsurance: false,
      });
      expect(other.ok).toBe(true);
    };

    const result = await sealedCommit(env.deps, {
      day: DAY,
      userId: 't2_dup',
      username: 'dup_user',
      choice: 'HOARD',
      stake: 5,
      buyInsurance: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('already_committed');
  });
});

describe('parseStoredCommit', () => {
  it('returns null for malformed JSON', () => {
    expect(parseStoredCommit('not json')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseStoredCommit(JSON.stringify({ stake: 5 }))).toBeNull();
  });

  it('defaults stake/ts to 0 and insured to false when those fields are absent', () => {
    const parsed = parseStoredCommit(JSON.stringify({ choice: 'FEED', username: 'someone' }));
    expect(parsed).toEqual({ choice: 'FEED', stake: 0, insured: false, username: 'someone', ts: 0 });
  });
});
