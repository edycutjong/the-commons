/**
 * getHistory edge cases not already reached through endpoints.test.ts: a
 * corrupted outcome summary is skipped entirely, and a corrupted per-user
 * result degrades to `mine: null` rather than throwing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, TEST_DAY, type TestEnv } from './helpers/env';
import { openRound } from '../src/server/core/rounds';
import { settleRound } from '../src/server/core/settle';
import { getHistory } from '../src/server/core/history';
import { K, OUTCOME_SUMMARY_FIELD, outcomeUserField } from '../src/server/core/keys';
import { commitsWithCounts, loadCommits } from './helpers/synth';
import { DAY_MS } from '../src/server/core/time';
import { defaultParams } from '../src/shared/payoffs';

const DAY = TEST_DAY;

describe('getHistory — corrupted-data resilience', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = makeEnv();
    await openRound(env.deps, {
      day: DAY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 'THE BLACKOUT POT',
      flavor: 'test',
      openedAt: DAY * DAY_MS,
      preseason: false,
    });
    await loadCommits(env.redis, DAY, commitsWithCounts({ FEED: 6, HOARD: 2 }));
    await settleRound(env.deps, DAY, { at: (DAY + 1) * DAY_MS });
  });

  it('skips a round whose outcome summary is corrupted JSON', async () => {
    await env.redis.hSet(K.outcome(DAY), { [OUTCOME_SUMMARY_FIELD]: 'not json' });
    const entries = await getHistory(env.deps, { meUserId: null, limit: 14 });
    expect(entries).toEqual([]);
  });

  it('degrades to mine:null when the per-user result is corrupted JSON', async () => {
    await env.redis.hSet(K.outcome(DAY), { [outcomeUserField('t2_syn_00000')]: 'not json' });
    const entries = await getHistory(env.deps, { meUserId: 't2_syn_00000', limit: 14 });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.mine).toBeNull();
  });

  it('breaks once the limit is reached, without inspecting older days', async () => {
    // Add a second (older) settled day; limit:1 must stop after the first.
    const OLDER = DAY - 1;
    await openRound(env.deps, {
      day: OLDER,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 'AN OLDER NIGHT',
      flavor: 'test',
      openedAt: OLDER * DAY_MS,
      preseason: false,
    });
    await loadCommits(env.redis, OLDER, commitsWithCounts({ FEED: 3, HOARD: 1 }));
    await settleRound(env.deps, OLDER, { at: DAY * DAY_MS });

    const entries = await getHistory(env.deps, { meUserId: null, limit: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outcome.title).toBe('THE BLACKOUT POT'); // newest first
  });

  it('skips a corrupted (non-numeric) round:index entry', async () => {
    await env.redis.zAdd(K.roundIndex, { member: 'not-a-number', score: 999_999 });
    const entries = await getHistory(env.deps, { meUserId: null, limit: 14 });
    expect(entries).toHaveLength(1); // the one real settled day, malformed one skipped
  });

  it('skips a round:index day whose round hash is entirely absent', async () => {
    await env.redis.zAdd(K.roundIndex, { member: String(DAY + 500), score: DAY + 500 });
    const entries = await getHistory(env.deps, { meUserId: null, limit: 14 });
    expect(entries).toHaveLength(1);
  });

  it('skips a round:index day whose round hash is corrupted (unparseable)', async () => {
    const BAD = DAY + 600;
    await env.redis.zAdd(K.roundIndex, { member: String(BAD), score: BAD });
    await env.redis.hSet(K.round(BAD), { archetype: 'calvinball' });
    const entries = await getHistory(env.deps, { meUserId: null, limit: 14 });
    expect(entries).toHaveLength(1);
  });

  it('skips a settled round whose outcome summary field is missing entirely', async () => {
    const NO_SUMMARY = DAY + 700;
    await openRound(env.deps, {
      day: NO_SUMMARY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 'GHOST NIGHT',
      flavor: 'test',
      openedAt: NO_SUMMARY * DAY_MS,
      preseason: false,
    });
    // Force to 'settled' without ever writing an outcome hash.
    await env.redis.hSet(K.round(NO_SUMMARY), { state: 'settled' });
    const entries = await getHistory(env.deps, { meUserId: null, limit: 14 });
    expect(entries).toHaveLength(1); // only the real settled round from beforeEach
  });
});
