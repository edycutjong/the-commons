/**
 * Pure streak + insurance updater. The settle pass feeds each participant's
 * previous streak record through this function; the result is written back
 * atomically inside the settle transaction.
 */

import type { OutcomeClass } from './types';

export type StreakRecord = {
  current: number;
  best: number;
  /** 1 = an unused streak-insurance token is held. */
  insuranceHeld: 0 | 1;
  /** Epoch-day of the last settled participation, or null for first night. */
  lastDay: number | null;
};

export type StreakUpdate = {
  next: StreakRecord;
  /** True when insurance was consumed to survive a loss this settle. */
  insuranceSaved: boolean;
};

export const FRESH_STREAK: StreakRecord = {
  current: 0,
  best: 0,
  insuranceHeld: 0,
  lastDay: null,
};

/**
 * Apply one settled night to a streak record.
 *
 * Rules:
 *  - Missing a night (gap > 1 day since lastDay) breaks continuity first.
 *  - win/push nights extend the streak.
 *  - loss nights reset it — unless insurance is held, which is consumed to
 *    preserve the streak ("one bad night forgiven").
 */
export function updateStreak(
  prev: StreakRecord,
  day: number,
  outcomeClass: OutcomeClass
): StreakUpdate {
  const gapBroken = prev.lastDay !== null && day - prev.lastDay > 1;
  const base = gapBroken ? 0 : prev.current;

  if (outcomeClass === 'loss') {
    if (prev.insuranceHeld === 1) {
      const current = base; // preserved, not extended — the night is forgiven, not won
      return {
        next: {
          current,
          best: Math.max(prev.best, current),
          insuranceHeld: 0,
          lastDay: day,
        },
        insuranceSaved: true,
      };
    }
    return {
      next: { current: 0, best: prev.best, insuranceHeld: prev.insuranceHeld, lastDay: day },
      insuranceSaved: false,
    };
  }

  const current = base + 1;
  return {
    next: {
      current,
      best: Math.max(prev.best, current),
      insuranceHeld: prev.insuranceHeld,
      lastDay: day,
    },
    insuranceSaved: false,
  };
}

/** Streak multiplier applied to displayed flame level (UI affordance only). */
export function flameLevel(current: number): 0 | 1 | 2 | 3 {
  if (current >= 14) return 3;
  if (current >= 7) return 2;
  if (current >= 3) return 1;
  return 0;
}

export function parseStreak(raw: Record<string, string> | undefined | null): StreakRecord {
  if (!raw || Object.keys(raw).length === 0) return { ...FRESH_STREAK };
  const current = Number.parseInt(raw['current'] ?? '0', 10) || 0;
  const best = Number.parseInt(raw['best'] ?? '0', 10) || 0;
  const insuranceHeld = raw['insuranceHeld'] === '1' ? 1 : 0;
  const lastDayRaw = raw['lastDay'];
  const lastDay =
    lastDayRaw === undefined || lastDayRaw === '' ? null : Number.parseInt(lastDayRaw, 10);
  return {
    current,
    best,
    insuranceHeld,
    lastDay: lastDay === null || Number.isNaN(lastDay) ? null : lastDay,
  };
}

export function serializeStreak(record: StreakRecord): Record<string, string> {
  return {
    current: String(record.current),
    best: String(record.best),
    insuranceHeld: String(record.insuranceHeld),
    lastDay: record.lastDay === null ? '' : String(record.lastDay),
  };
}
