import { describe, expect, it } from 'vitest';
import {
  FRESH_STREAK,
  flameLevel,
  parseStreak,
  serializeStreak,
  updateStreak,
} from '../src/shared/payoffs';

describe('streak updater (pure)', () => {
  it('first night win starts the streak at 1', () => {
    const u = updateStreak(FRESH_STREAK, 100, 'win');
    expect(u.next).toEqual({ current: 1, best: 1, insuranceHeld: 0, lastDay: 100 });
    expect(u.insuranceSaved).toBe(false);
  });

  it('consecutive nights extend and track best', () => {
    let s = FRESH_STREAK;
    for (let day = 100; day < 105; day++) s = updateStreak(s, day, 'win').next;
    expect(s.current).toBe(5);
    expect(s.best).toBe(5);
  });

  it('a push extends the streak like a win (surviving counts)', () => {
    const s = updateStreak({ current: 3, best: 3, insuranceHeld: 0, lastDay: 100 }, 101, 'push');
    expect(s.next.current).toBe(4);
  });

  it('a loss without insurance resets to zero but keeps best', () => {
    const s = updateStreak({ current: 6, best: 6, insuranceHeld: 0, lastDay: 100 }, 101, 'loss');
    expect(s.next.current).toBe(0);
    expect(s.next.best).toBe(6);
  });

  it('insurance eats one loss, preserves the streak, and is consumed', () => {
    const s = updateStreak({ current: 6, best: 6, insuranceHeld: 1, lastDay: 100 }, 101, 'loss');
    expect(s.insuranceSaved).toBe(true);
    expect(s.next.current).toBe(6); // preserved, not extended
    expect(s.next.insuranceHeld).toBe(0);
  });

  it('insurance is NOT consumed on a win', () => {
    const s = updateStreak({ current: 2, best: 2, insuranceHeld: 1, lastDay: 100 }, 101, 'win');
    expect(s.insuranceSaved).toBe(false);
    expect(s.next.insuranceHeld).toBe(1);
  });

  it('a missed night breaks continuity before the outcome applies', () => {
    const s = updateStreak({ current: 9, best: 9, insuranceHeld: 0, lastDay: 100 }, 103, 'win');
    expect(s.next.current).toBe(1); // gap reset, then tonight's win
    expect(s.next.best).toBe(9);
  });

  it('a gap plus a loss with insurance saves only the (reset) zero', () => {
    const s = updateStreak({ current: 9, best: 9, insuranceHeld: 1, lastDay: 100 }, 105, 'loss');
    expect(s.insuranceSaved).toBe(true);
    expect(s.next.current).toBe(0);
  });

  it('round-trips through redis hash serialization', () => {
    const record = { current: 4, best: 7, insuranceHeld: 1 as const, lastDay: 123 };
    expect(parseStreak(serializeStreak(record))).toEqual(record);
    expect(parseStreak(serializeStreak({ ...record, lastDay: null }))).toEqual({
      ...record,
      lastDay: null,
    });
    expect(parseStreak(null)).toEqual(FRESH_STREAK);
    expect(parseStreak({})).toEqual(FRESH_STREAK);
  });

  it('flame levels tier at 3/7/14', () => {
    expect(flameLevel(0)).toBe(0);
    expect(flameLevel(2)).toBe(0);
    expect(flameLevel(3)).toBe(1);
    expect(flameLevel(7)).toBe(2);
    expect(flameLevel(14)).toBe(3);
  });
});
