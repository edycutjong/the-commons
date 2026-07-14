/**
 * Pure season-point economy rules. Balances live in the `season:points` zset;
 * a user with no entry has an implicit balance of `startingPoints` (no signup
 * write needed — first settle materializes it).
 */

import type { Economy } from './types';

/** Effective balance for a possibly-absent zset score. */
export function effectiveBalance(zscore: number | undefined, economy: Economy): number {
  return zscore === undefined ? economy.startingPoints : zscore;
}

/** Highest stake a player may pledge right now. */
export function maxStakeFor(balance: number, economy: Economy): number {
  return Math.max(0, Math.min(economy.maxStake, Math.floor(balance)));
}

/** Validate + clamp a requested stake. Returns null when the request is malformed. */
export function sanitizeStake(raw: unknown, balance: number, economy: Economy): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const stake = Math.floor(raw);
  if (stake < 0) return null;
  return Math.min(stake, maxStakeFor(balance, economy));
}

/**
 * Season-point change for one settled night:
 * dilemma delta + flat participation reward, floored so balances never go
 * negative (stakes are pledges against what you have, but decay/insurance
 * ordering must never strand a player below zero).
 */
export function applyNightToBalance(balance: number, delta: number, economy: Economy): number {
  return Math.max(0, balance + delta + economy.participationReward);
}
