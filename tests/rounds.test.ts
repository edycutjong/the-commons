/**
 * rounds.ts pure-parsing edge cases not already reached through
 * endpoints.test.ts / settle.test.ts: malformed/missing stored fields fall
 * back to sane defaults, a malformed approved-Forge queue entry falls
 * through to the built-in rotation instead of throwing, openRound's own
 * `?? ` defaults for fully-omitted optional fields, a corrupted
 * round:current pointer, and the pot-ticker's own NaN-safe fallback.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, TEST_DAY, type TestEnv } from './helpers/env';
import {
  currentRound,
  nextDilemma,
  openRound,
  parseRound,
  publicRoundView,
  serializeRound,
} from '../src/server/core/rounds';
import { K } from '../src/server/core/keys';
import { DAY_MS } from '../src/server/core/time';
import { defaultParams } from '../src/shared/payoffs';
import type { RoundResponse } from '../src/shared/api';

describe('parseRound', () => {
  it('falls back to archetype defaults when the stored params are corrupted JSON', () => {
    const round = parseRound({
      day: '20000',
      archetype: 'public_pot',
      params: 'not json',
      state: 'open',
      title: 'THE BLACKOUT POT',
      flavor: 'test',
      author: '',
      postId: '',
      openedAt: '0',
      settledAt: '',
      preseason: '0',
    });
    expect(round).not.toBeNull();
    expect(round!.params).toEqual(defaultParams('public_pot'));
  });

  it('returns null for an unknown archetype', () => {
    expect(parseRound({ archetype: 'calvinball' })).toBeNull();
  });

  it('returns null when the archetype field is missing entirely', () => {
    expect(parseRound({})).toBeNull();
  });

  it('defaults every other field when only archetype is present', () => {
    const round = parseRound({ archetype: 'public_pot' });
    expect(round).toEqual({
      day: 0,
      archetype: 'public_pot',
      params: {}, // raw['params'] ?? '{}' -> parses to {} (not archetype defaults)
      state: 'open',
      title: 'THE COMMONS',
      flavor: '',
      author: null,
      postId: null,
      openedAt: 0,
      settledAt: null,
      preseason: false,
    });
  });

  it('treats non-numeric day/openedAt strings as 0', () => {
    const round = parseRound({ archetype: 'public_pot', day: 'abc', openedAt: 'xyz' });
    expect(round!.day).toBe(0);
    expect(round!.openedAt).toBe(0);
  });
});

describe('serializeRound', () => {
  it('renders a non-null settledAt as its string form', () => {
    const record = {
      day: 1,
      archetype: 'public_pot' as const,
      params: defaultParams('public_pot'),
      state: 'settled' as const,
      title: 't',
      flavor: 'f',
      author: null,
      postId: null,
      openedAt: 0,
      settledAt: 12_345,
      preseason: false,
    };
    expect(serializeRound(record)['settledAt']).toBe('12345');
  });
});

describe('openRound — omitted optional fields', () => {
  it('defaults author/postId/preseason when the caller omits them entirely', async () => {
    const env = makeEnv();
    const record = await openRound(env.deps, {
      day: TEST_DAY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 't',
      flavor: 'f',
      openedAt: TEST_DAY * DAY_MS,
    });
    expect(record.author).toBeNull();
    expect(record.postId).toBeNull();
    expect(record.preseason).toBe(false);
  });
});

describe('currentRound — corrupted pointer', () => {
  it('returns null when round:current is not a parseable number', async () => {
    const env = makeEnv();
    await env.redis.set(K.roundCurrent, 'not-a-number');
    expect(await currentRound(env.deps)).toBeNull();
  });

  it('GET /api/round reflects the same null-round fallback', async () => {
    const env = makeEnv();
    await env.redis.set(K.roundCurrent, 'not-a-number');
    const res = await env.app.request('/api/round');
    const body = (await res.json()) as RoundResponse;
    expect(body.round).toBeNull();
  });
});

describe('publicRoundView — pot display fallback', () => {
  it('shows 0 when the display pot counter is corrupted (non-numeric)', async () => {
    const env = makeEnv();
    await openRound(env.deps, {
      day: TEST_DAY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 't',
      flavor: 'f',
      openedAt: TEST_DAY * DAY_MS,
      preseason: false,
    });
    await env.redis.set(K.pot(TEST_DAY), 'not-a-number');
    const round = (await currentRound(env.deps))!;
    const view = await publicRoundView(env.deps, round);
    expect(view.pot).toBe(0);
  });

  it('shows 0 when there is no display pot counter at all', async () => {
    const env = makeEnv();
    await openRound(env.deps, {
      day: TEST_DAY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 't',
      flavor: 'f',
      openedAt: TEST_DAY * DAY_MS,
      preseason: false,
    });
    const round = (await currentRound(env.deps))!;
    const view = await publicRoundView(env.deps, round);
    expect(view.pot).toBe(0);
  });
});

describe('nextDilemma', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('falls through to the built-in rotation when the approved entry is corrupted JSON', async () => {
    await env.redis.zAdd(K.forgeApproved, { member: 'not-json-at-all', score: 1 });
    const dilemma = await nextDilemma(env.deps, 20_000);
    // day 20000 % 5 === 0 -> ROTATION[0] = THE BLACKOUT POT (public_pot)
    expect(dilemma.archetype).toBe('public_pot');
    expect(dilemma.title).toBe('THE BLACKOUT POT');
    expect(dilemma.author).toBeNull();
    // the malformed entry was still consumed
    expect(await env.redis.zCard(K.forgeApproved)).toBe(0);
  });

  it('defaults params to the archetype defaults when the approved entry omits them', async () => {
    await env.redis.zAdd(K.forgeApproved, {
      member: JSON.stringify({ archetype: 'chicken', title: 'A FORGED NIGHT', flavor: 'x' }),
      score: 1,
    });
    const dilemma = await nextDilemma(env.deps, 20_000);
    expect(dilemma.archetype).toBe('chicken');
    expect(dilemma.params).toEqual(defaultParams('chicken'));
    expect(dilemma.author).toBeNull();
  });

  it('credits the author when the approved entry provides one', async () => {
    await env.redis.zAdd(K.forgeApproved, {
      member: JSON.stringify({
        archetype: 'chicken',
        title: 'A FORGED NIGHT',
        flavor: 'x',
        author: 'some_forger',
      }),
      score: 1,
    });
    const dilemma = await nextDilemma(env.deps, 20_000);
    expect(dilemma.author).toBe('some_forger');
  });
});

