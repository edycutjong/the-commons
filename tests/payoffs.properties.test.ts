/**
 * Property-style tests over the payoff engine:
 *  - threshold continuity: sweeping the choice split flips the outcome class
 *    exactly once, exactly at the parameterized threshold;
 *  - percent invariance: identical proportions at N=8 and N=8000 produce the
 *    identical outcome class AND identical verdict strings (drama is
 *    population-invariant — the judge-proof property);
 *  - determinism: same inputs → deep-equal resolutions, input order ignored;
 *  - integer safety: every delta is an integer at any multiplier setting.
 */

import { describe, expect, it } from 'vitest';
import { resolve, defaultParams, ARCHETYPES, type Archetype } from '../src/shared/payoffs';
import { commitsWithCounts, scaleCounts } from './helpers/synth';

describe('threshold continuity — outcome flips exactly at the line', () => {
  it('public pot: one transition across a 1000-voter sweep, at 700', () => {
    const P = defaultParams('public_pot');
    let transitions = 0;
    let prev: string | null = null;
    for (let feed = 690; feed <= 710; feed++) {
      const r = resolve('public_pot', P, commitsWithCounts({ FEED: feed, HOARD: 1000 - feed }));
      if (prev !== null && r.outcome.groupOutcome !== prev) {
        transitions++;
        expect(feed).toBe(700); // flips exactly when 70.0% is reached
      }
      prev = r.outcome.groupOutcome;
    }
    expect(transitions).toBe(1);
  });

  it('stag hunt: one transition, at 800/1000', () => {
    const P = defaultParams('stag_hunt');
    let transitions = 0;
    let prev: string | null = null;
    for (let stag = 790; stag <= 810; stag++) {
      const r = resolve('stag_hunt', P, commitsWithCounts({ STAG: stag, HARE: 1000 - stag }));
      if (prev !== null && r.outcome.groupOutcome !== prev) {
        transitions++;
        expect(stag).toBe(800);
      }
      prev = r.outcome.groupOutcome;
    }
    expect(transitions).toBe(1);
  });

  it('chicken: one transition, at 501/1000 (strictly-over semantics)', () => {
    const P = defaultParams('chicken');
    let transitions = 0;
    let prev: string | null = null;
    for (let dare = 490; dare <= 510; dare++) {
      const r = resolve('chicken', P, commitsWithCounts({ DARE: dare, SWERVE: 1000 - dare }));
      if (prev !== null && r.outcome.groupOutcome !== prev) {
        transitions++;
        expect(dare).toBe(501);
      }
      prev = r.outcome.groupOutcome;
    }
    expect(transitions).toBe(1);
  });

  it('exact-n heist: the success window is a closed band [75, 175] of 1000', () => {
    const P = defaultParams('exact_n'); // 12.5% ± 5% → [7.5%, 17.5%]
    for (const heist of [74, 75, 76, 125, 174, 175, 176]) {
      const r = resolve('exact_n', P, commitsWithCounts({ HEIST: heist, GUARD: 1000 - heist }));
      const opened = r.outcome.verdict.includes('The vault opened');
      expect(opened).toBe(heist >= 75 && heist <= 175);
    }
  });
});

describe('percent invariance — N=8 vs N=8000, same proportions, same drama', () => {
  const CASES: { archetype: Archetype; counts: Record<string, number> }[] = [
    { archetype: 'public_pot', counts: { FEED: 6, HOARD: 2 } }, // 75% ≥ 70%
    { archetype: 'public_pot', counts: { FEED: 5, HOARD: 3 } }, // 62.5% < 70%
    { archetype: 'stag_hunt', counts: { STAG: 7, HARE: 1 } }, // 87.5% ≥ 80%
    { archetype: 'chicken', counts: { DARE: 4, SWERVE: 4 } }, // 50% ≤ 50%
    { archetype: 'chicken', counts: { DARE: 5, SWERVE: 3 } }, // 62.5% > 50%
    { archetype: 'lowest_unique', counts: { BID_1: 4, BID_2: 2, BID_3: 2 } },
    { archetype: 'exact_n', counts: { HEIST: 1, GUARD: 7 } }, // 12.5% in band
    { archetype: 'exact_n', counts: { HEIST: 3, GUARD: 5 } }, // 37.5% outside
  ];

  for (const { archetype, counts } of CASES) {
    it(`${archetype} @ ${JSON.stringify(counts)}`, () => {
      const params = defaultParams(archetype);
      const small = resolve(archetype, params, commitsWithCounts(counts));
      const large = resolve(archetype, params, commitsWithCounts(scaleCounts(counts, 1000)));
      expect(large.outcome.groupOutcome).toBe(small.outcome.groupOutcome);
      expect(large.outcome.verdict).toBe(small.outcome.verdict); // pct strings identical
      expect(large.outcome.splitPct).toEqual(small.outcome.splitPct);
    });
  }
});

describe('determinism', () => {
  it('same inputs give deep-equal resolutions', () => {
    for (const archetype of ARCHETYPES) {
      const counts: Record<string, number> =
        archetype === 'lowest_unique'
          ? { BID_1: 5, BID_2: 3, BID_4: 2 }
          : archetype === 'exact_n'
            ? { HEIST: 2, GUARD: 14 }
            : archetype === 'chicken'
              ? { DARE: 6, SWERVE: 10 }
              : archetype === 'stag_hunt'
                ? { STAG: 13, HARE: 3 }
                : { FEED: 12, HOARD: 4 };
      const commits = commitsWithCounts(counts);
      const a = resolve(archetype, defaultParams(archetype), commits);
      const b = resolve(
        archetype,
        JSON.parse(JSON.stringify(defaultParams(archetype))),
        JSON.parse(JSON.stringify(commits))
      );
      expect(b).toEqual(a);
    }
  });

  it('input order does not matter (engine sorts internally)', () => {
    const commits = commitsWithCounts({ FEED: 9, HOARD: 4 });
    const shuffled = [...commits].reverse();
    const a = resolve('public_pot', defaultParams('public_pot'), commits);
    const b = resolve('public_pot', defaultParams('public_pot'), shuffled);
    expect(b).toEqual(a);
  });
});

describe('integer safety', () => {
  it('every delta is an integer across awkward multipliers and stakes', () => {
    const params = { threshold: 0.5, feedMult: 1.5, hoardMult: 2.5 };
    const commits = commitsWithCounts({ FEED: 7, HOARD: 3 }).map((c, i) => ({
      ...c,
      stake: [1, 3, 7, 11, 13, 17, 19, 23, 29, 31][i % 10]!,
    }));
    const r = resolve('public_pot', params, commits);
    for (const u of r.perUser) expect(Number.isInteger(u.delta)).toBe(true);

    const lub = resolve(
      'lowest_unique',
      { maxBid: 5, winMult: 4.5, loseFrac: 0.25 },
      commitsWithCounts({ BID_1: 3, BID_5: 1 }).map((c) => ({ ...c, stake: 33 }))
    );
    for (const u of lub.perUser) expect(Number.isInteger(u.delta)).toBe(true);
  });

  it('void nights exist for every archetype (empty commits)', () => {
    for (const archetype of ARCHETYPES) {
      const r = resolve(archetype, defaultParams(archetype), []);
      expect(r.outcome.groupOutcome).toBe('void');
    }
  });
});
