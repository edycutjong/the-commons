/** UTC day math — pure, direct unit coverage of every exported helper. */

import { describe, expect, it } from 'vitest';
import { DAY_MS, dayLabel, dayOf, dayStartMs, nextMidnightUtc, weekOf } from '../src/server/core/time';

describe('time — UTC day math', () => {
  it('dayOf floors ms to the UTC epoch-day', () => {
    expect(dayOf(0)).toBe(0);
    expect(dayOf(DAY_MS - 1)).toBe(0);
    expect(dayOf(DAY_MS)).toBe(1);
    expect(dayOf(DAY_MS * 20_000 + 12 * 3_600_000)).toBe(20_000);
  });

  it('nextMidnightUtc is the next 00:00 UTC strictly after ms', () => {
    expect(nextMidnightUtc(DAY_MS * 5)).toBe(DAY_MS * 6);
    expect(nextMidnightUtc(DAY_MS * 5 + 1)).toBe(DAY_MS * 6);
    expect(nextMidnightUtc(DAY_MS * 6 - 1)).toBe(DAY_MS * 6);
  });

  it('dayStartMs is the inverse of dayOf', () => {
    expect(dayStartMs(0)).toBe(0);
    expect(dayStartMs(20_000)).toBe(20_000 * DAY_MS);
    expect(dayOf(dayStartMs(12_345))).toBe(12_345);
  });

  it('dayLabel renders an ISO YYYY-MM-DD for a day number', () => {
    expect(dayLabel(0)).toBe('1970-01-01');
    expect(dayLabel(1)).toBe('1970-01-02');
  });

  it('weekOf buckets seven consecutive days into the same week', () => {
    expect(weekOf(0)).toBe(0);
    expect(weekOf(6)).toBe(0);
    expect(weekOf(7)).toBe(1);
    expect(weekOf(20_000)).toBe(Math.floor(20_000 / 7));
  });
});
