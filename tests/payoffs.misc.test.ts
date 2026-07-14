/**
 * Small pure-utility edge cases across the payoffs module not already
 * reached through the archetype/economy/forge-param test suites:
 * archetypeSpec's own defensive throw, param()'s non-numeric fallback,
 * decayScore's floor-at-zero on a negative score, seededPick on an empty
 * list, and parseStreak's NaN-string fallback.
 */

import { describe, expect, it } from 'vitest';
import {
  archetypeSpec,
  param,
  decayScore,
  seededPick,
  parseStreak,
  type Archetype,
} from '../src/shared/payoffs';

describe('archetypeSpec', () => {
  it('throws for an archetype id outside the known table', () => {
    expect(() => archetypeSpec('calvinball' as Archetype)).toThrow(/unknown archetype/);
  });
});

describe('param', () => {
  it('falls back when the stored value is present but not a finite number', () => {
    expect(param({ threshold: 'nope' as unknown as number }, 'threshold', 0.7)).toBe(0.7);
    expect(param({ threshold: Number.NaN }, 'threshold', 0.7)).toBe(0.7);
    expect(param({}, 'threshold', 0.7)).toBe(0.7);
  });
});

describe('decayScore', () => {
  it('floors a decayed negative score at zero', () => {
    expect(decayScore(-10, 0.8)).toBe(0);
  });

  it('floors a positive score toward zero (not away)', () => {
    expect(decayScore(11, 0.8)).toBe(8); // floor(8.8)
  });
});

describe('seededPick', () => {
  it('returns undefined for an empty list', () => {
    expect(seededPick('any-seed', [])).toBeUndefined();
  });

  it('is deterministic for a fixed seed + list', () => {
    const items = ['a', 'b', 'c'];
    expect(seededPick('week-9', items)).toBe(seededPick('week-9', items));
  });
});

describe('parseStreak', () => {
  it('falls back to 0 when current/best are non-numeric strings', () => {
    const streak = parseStreak({ current: 'abc', best: 'xyz', insuranceHeld: '0', lastDay: '5' });
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(0);
  });

  it('falls back to 0 when current/best fields are missing entirely (non-empty raw)', () => {
    const streak = parseStreak({ insuranceHeld: '0', lastDay: '5' });
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(0);
  });
});
