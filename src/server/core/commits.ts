/**
 * The sealed commit — invariants I1 and I2 live here.
 *
 * Transaction design (see COMPLEXITY.md §1):
 *  - Every commit WATCHes `round:{day}`. The settle pass flips that key's
 *    state inside its own transaction, so a commit racing the settle either
 *    lands before the flip (counted) or its EXEC returns null and the player
 *    is told "the envelope is sealed" — nothing partial ever lands.
 *  - One commit per account: the commit body is written with HSETNX keyed by
 *    userId. A double-tap race can at worst re-write nothing (NX) — the hash
 *    key space is the uniqueness guarantee.
 *  - Insurance purchases ride inside the same MULTI (balance materialized as
 *    an absolute zAdd), and such commits additionally WATCH `commit:{day}`
 *    so the paired writes can never half-apply.
 */

import type { Deps } from './deps';
import { K } from './keys';
import { getRound } from './rounds';
import { nextMidnightUtc } from './time';
import {
  ECONOMY,
  effectiveBalance,
  isValidChoice,
  maxStakeFor,
  parseStreak,
  sanitizeStake,
  serializeStreak,
} from '../../shared/payoffs';

export type StoredCommit = {
  choice: string;
  stake: number;
  insured: boolean;
  username: string;
  ts: number;
};

export type CommitInput = {
  day: number;
  userId: string;
  username: string;
  choice: string;
  stake: number;
  buyInsurance: boolean;
};

export type CommitOk = {
  ok: true;
  day: number;
  choice: string;
  stake: number;
  insured: boolean;
  participants: number;
  pot: number;
  revealAt: number;
};

export type CommitErr = {
  ok: false;
  code:
    | 'no_round'
    | 'round_sealed'
    | 'already_committed'
    | 'bad_choice'
    | 'bad_stake'
    | 'insufficient_points'
    | 'conflict';
  message: string;
};

export type CommitResult = CommitOk | CommitErr;

const MAX_ATTEMPTS = 4;

export async function sealedCommit(deps: Deps, input: CommitInput): Promise<CommitResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await tryCommit(deps, input);
    if (result.ok || result.code !== 'conflict') return result;
  }
  return {
    ok: false,
    code: 'round_sealed',
    message: 'The commons is deciding your fate — the envelope is sealed.',
  };
}

async function tryCommit(deps: Deps, input: CommitInput): Promise<CommitResult> {
  const { day, userId, username } = input;
  const round = await getRound(deps, day);
  if (!round) return { ok: false, code: 'no_round', message: 'No dilemma is open tonight.' };
  if (round.state !== 'open') {
    return { ok: false, code: 'round_sealed', message: 'The envelope is sealed. Midnight has spoken.' };
  }
  if (!isValidChoice(round.archetype, input.choice)) {
    return { ok: false, code: 'bad_choice', message: 'That choice does not exist tonight.' };
  }

  const prior = await deps.redis.hGet(K.commit(day), userId);
  if (prior !== undefined) {
    return {
      ok: false,
      code: 'already_committed',
      message: 'Your envelope is already sealed. One choice a night.',
    };
  }

  const balanceScore = await deps.redis.zScore(K.seasonPoints, username);
  const balance = effectiveBalance(balanceScore, ECONOMY);
  const streakRaw = await deps.redis.hGetAll(K.streak(userId));
  const streak = parseStreak(streakRaw);

  const wantInsurance = input.buyInsurance && streak.insuranceHeld === 0;
  const insuranceCharge = wantInsurance ? ECONOMY.insuranceCost : 0;
  if (wantInsurance && balance < ECONOMY.insuranceCost) {
    return {
      ok: false,
      code: 'insufficient_points',
      message: `Streak insurance costs ${ECONOMY.insuranceCost} season points.`,
    };
  }
  const stakeBudget = balance - insuranceCharge;
  const stake = sanitizeStake(input.stake, stakeBudget, ECONOMY);
  if (stake === null) {
    return { ok: false, code: 'bad_stake', message: 'Stakes must be a non-negative number.' };
  }
  if (input.stake > 0 && stake === 0 && maxStakeFor(stakeBudget, ECONOMY) === 0) {
    return { ok: false, code: 'insufficient_points', message: 'No season points left to stake.' };
  }

  const stored: StoredCommit = {
    choice: input.choice,
    stake,
    insured: wantInsurance || streak.insuranceHeld === 1,
    username,
    ts: deps.now(),
  };

  // Insured commits pair a balance write with the commit; watch the commit
  // hash too so the pair is all-or-nothing even across commit races.
  const tx = wantInsurance
    ? await deps.redis.watch(K.round(day), K.commit(day))
    : await deps.redis.watch(K.round(day));

  // Close the TOCTOU window: re-check state after WATCH is armed.
  const stateNow = await deps.redis.hGet(K.round(day), 'state');
  if (stateNow !== 'open') {
    await tx.unwatch();
    return { ok: false, code: 'round_sealed', message: 'The envelope is sealed. Midnight has spoken.' };
  }

  await tx.multi();
  await tx.hSetNX(K.commit(day), userId, JSON.stringify(stored));
  if (wantInsurance) {
    await tx.zAdd(K.seasonPoints, { member: username, score: balance - insuranceCharge });
    await tx.hSet(K.streak(userId), serializeStreak({ ...streak, insuranceHeld: 1 }));
  }
  const results = await tx.exec();

  if (results === null) {
    // WATCH tripped: either the settle flipped the round, or (insured path)
    // another commit landed mid-flight. Distinguish by re-reading state.
    const state = await deps.redis.hGet(K.round(day), 'state');
    if (state !== 'open') {
      return { ok: false, code: 'round_sealed', message: 'The envelope is sealed. Midnight has spoken.' };
    }
    return { ok: false, code: 'conflict', message: 'retry' };
  }

  const wrote = results[0] === 1 || results[0] === '1';
  if (!wrote) {
    return {
      ok: false,
      code: 'already_committed',
      message: 'Your envelope is already sealed. One choice a night.',
    };
  }

  // Display ticker only — authoritative pot is recomputed from commits at settle.
  const pot = await deps.redis.incrBy(K.pot(day), stake);
  const participants = await deps.redis.hLen(K.commit(day));

  return {
    ok: true,
    day,
    choice: input.choice,
    stake,
    insured: stored.insured,
    participants,
    pot,
    revealAt: nextMidnightUtc(deps.now()),
  };
}

export function parseStoredCommit(raw: string): StoredCommit | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCommit>;
    if (typeof parsed.choice !== 'string' || typeof parsed.username !== 'string') return null;
    return {
      choice: parsed.choice,
      stake: typeof parsed.stake === 'number' ? parsed.stake : 0,
      insured: parsed.insured === true,
      username: parsed.username,
      ts: typeof parsed.ts === 'number' ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}
