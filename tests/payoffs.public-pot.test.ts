import { describe, expect, it } from 'vitest';
import { resolve, defaultParams } from '../src/shared/payoffs';
import { commitsWithCounts } from './helpers/synth';

const P = defaultParams('public_pot'); // threshold 0.7, feedMult 2, hoardMult 3

describe('public pot — threshold multiply/burn', () => {
  it('survives at exactly the 70% threshold (>= semantics)', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 70, HOARD: 30 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
    expect(r.outcome.verdict).toContain('70.0% fed');
  });

  it('burns one voter below the threshold', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 69, HOARD: 31 }));
    expect(r.outcome.groupOutcome).toBe('ruin');
    expect(r.outcome.verdict).toContain('The pot burned');
  });

  it('the 69.4%-vs-70% knife edge burns by six tenths of a point', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 347, HOARD: 153 }));
    expect(r.outcome.groupOutcome).toBe('ruin');
    expect(r.outcome.splitPct['FEED']).toBe(69.4);
    expect(r.outcome.verdict).toBe('30.6% hoarded. The pot burned.');
  });

  it('the 58%-hoard catastrophe produces the demo verdict', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 168, HOARD: 232 }));
    expect(r.outcome.verdict).toBe('58.0% hoarded. The pot burned.');
  });

  it('feeders double their stake on success (delta = +stake)', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 8, HOARD: 2 }));
    const feeder = r.perUser.find((u) => u.choice === 'FEED');
    expect(feeder).toBeDefined();
    expect(feeder!.delta).toBe(feeder!.stake);
    expect(feeder!.outcomeClass).toBe('win');
  });

  it('hoarders freeride at 3x on success (delta = +2*stake)', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 8, HOARD: 2 }));
    const hoarder = r.perUser.find((u) => u.choice === 'HOARD');
    expect(hoarder!.delta).toBe(2 * hoarder!.stake);
    expect(hoarder!.note).toBe('freerode');
  });

  it('a burn destroys every stake, feeder and hoarder alike', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 3, HOARD: 7 }));
    for (const u of r.perUser) {
      expect(u.delta).toBe(-u.stake);
      expect(u.outcomeClass).toBe(u.stake > 0 ? 'loss' : 'push');
    }
  });

  it('zero-stake players ride along without gaining or losing', () => {
    const commits = commitsWithCounts({ FEED: 4 }).map((c) => ({ ...c, stake: 0 }));
    const r = resolve('public_pot', P, commits);
    for (const u of r.perUser) {
      expect(u.delta).toBe(0);
      expect(u.outcomeClass).toBe('push');
    }
  });

  it('empty commits resolve to a void night', () => {
    const r = resolve('public_pot', P, []);
    expect(r.outcome.groupOutcome).toBe('void');
    expect(r.outcome.participants).toBe(0);
    expect(r.perUser).toEqual([]);
  });

  it('pot equals the sum of stakes', () => {
    const commits = commitsWithCounts({ FEED: 5, HOARD: 5 });
    const r = resolve('public_pot', P, commits);
    expect(r.outcome.pot).toBe(commits.reduce((s, c) => s + c.stake, 0));
  });

  it('split counts every choice exactly', () => {
    const r = resolve('public_pot', P, commitsWithCounts({ FEED: 13, HOARD: 7 }));
    expect(r.outcome.split).toEqual({ FEED: 13, HOARD: 7 });
    expect(r.outcome.participants).toBe(20);
  });

  it('a float-noise threshold (0.6999999999) behaves as 0.7', () => {
    const noisy = { ...P, threshold: 0.6999999999 };
    const r = resolve('public_pot', noisy, commitsWithCounts({ FEED: 70, HOARD: 30 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
  });

  it('gain() rounds a sub-1 multiplier down to a negative delta (half away from zero)', () => {
    // Not a shipped/clamped configuration — the resolver is a pure function of
    // whatever params it is handed, and this exercises gain()'s negative branch.
    const shrink = { threshold: 0.5, feedMult: 0.5, hoardMult: 3 };
    const r = resolve('public_pot', shrink, commitsWithCounts({ FEED: 10 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
    for (const u of r.perUser) {
      expect(u.delta).toBe(-Math.round(u.stake / 2));
      expect(u.outcomeClass).toBe('loss');
    }
  });
});
