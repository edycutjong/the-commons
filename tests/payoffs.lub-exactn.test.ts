import { describe, expect, it } from 'vitest';
import { resolve, defaultParams } from '../src/shared/payoffs';
import { commitsWithCounts } from './helpers/synth';

const LUB = defaultParams('lowest_unique'); // maxBid 5, winMult 4, loseFrac 0.5
const HEIST = defaultParams('exact_n'); // targetFrac 0.125, band 0.05, heistMult 5, guardMult 1.5

describe('lowest unique bid — the quiet number', () => {
  it('a truly unique low bid wins outright', () => {
    const r = resolve(
      'lowest_unique',
      LUB,
      commitsWithCounts({ BID_1: 3, BID_2: 3, BID_3: 1, BID_4: 1, BID_5: 1 })
    );
    expect(r.outcome.verdict).toContain('BID 3');
    const winners = r.perUser.filter((u) => u.note === 'unique_winner');
    expect(winners).toHaveLength(1);
    expect(winners[0]!.choice).toBe('BID_3');
  });

  it('rarest-share generalization: ties in share go to the LOWER bid', () => {
    const r = resolve(
      'lowest_unique',
      LUB,
      commitsWithCounts({ BID_2: 2, BID_4: 2, BID_5: 4 })
    );
    expect(r.outcome.verdict).toContain('BID 2');
  });

  it('winners multiply x4, losers burn half their stake', () => {
    const r = resolve(
      'lowest_unique',
      LUB,
      commitsWithCounts({ BID_1: 4, BID_3: 1 })
    );
    const winner = r.perUser.find((u) => u.note === 'unique_winner')!;
    expect(winner.delta).toBe(3 * winner.stake);
    for (const u of r.perUser.filter((x) => x.note === 'outbid')) {
      expect(u.delta).toBe(-Math.round(u.stake * 0.5));
    }
  });

  it('when everyone bids the same number, everyone "wins" it', () => {
    const r = resolve('lowest_unique', LUB, commitsWithCounts({ BID_2: 5 }));
    expect(r.outcome.verdict).toContain('BID 2');
    expect(r.perUser.every((u) => u.note === 'unique_winner')).toBe(true);
  });

  it('equal shares across all bids crown BID 1', () => {
    const r = resolve(
      'lowest_unique',
      LUB,
      commitsWithCounts({ BID_1: 2, BID_2: 2, BID_3: 2, BID_4: 2, BID_5: 2 })
    );
    expect(r.outcome.verdict).toContain('BID 1');
  });

  it('no valid bids at all: the ledger stays blank and everyone burns their loseFrac', () => {
    // BID_99 is outside the [1, maxBid] table — bidValue rejects it entirely.
    const r = resolve('lowest_unique', LUB, commitsWithCounts({ BID_99: 4 }));
    expect(r.outcome.verdict).toBe('No valid bids. The ledger stays blank.');
    expect(r.outcome.detail).toBe('Nobody bid inside the table.');
    for (const u of r.perUser) {
      expect(u.note).toBe('outbid');
      expect(u.delta).toBe(-Math.round(u.stake * 0.5));
    }
  });
});

describe('exact-n heist — the vault opens for ~N%', () => {
  it('opens at exactly the target fraction', () => {
    const r = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 1, GUARD: 7 }));
    expect(r.outcome.verdict).toContain('The vault opened');
    expect(r.outcome.splitPct['HEIST']).toBe(12.5);
  });

  it('opens at the inclusive band edges', () => {
    // target 12.5% ± 5% → [7.5%, 17.5%] — 3/40 = 7.5% and 7/40 = 17.5%
    const low = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 3, GUARD: 37 }));
    const high = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 7, GUARD: 33 }));
    expect(low.outcome.verdict).toContain('The vault opened');
    expect(high.outcome.verdict).toContain('The vault opened');
  });

  it('trips the alarm just outside the band, both directions', () => {
    // 2/40 = 5% (under), 8/40 = 20% (over)
    const under = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 2, GUARD: 38 }));
    const over = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 8, GUARD: 32 }));
    expect(under.outcome.verdict).toContain('alarm');
    expect(over.outcome.verdict).toContain('alarm');
  });

  it('successful heisters take x5 while guards bleed a quarter', () => {
    const r = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 1, GUARD: 7 }));
    const heister = r.perUser.find((u) => u.choice === 'HEIST')!;
    expect(heister.delta).toBe(4 * heister.stake);
    for (const g of r.perUser.filter((u) => u.choice === 'GUARD')) {
      expect(g.delta).toBe(-Math.round(g.stake * 0.25));
    }
  });

  it('failed heisters lose everything; guards collect the bounty', () => {
    const r = resolve('exact_n', HEIST, commitsWithCounts({ HEIST: 10, GUARD: 10 }));
    for (const u of r.perUser) {
      if (u.choice === 'HEIST') expect(u.delta).toBe(-u.stake);
      else expect(u.delta).toBeGreaterThan(0);
    }
  });

  it('an untouched vault is a guard triumph', () => {
    const r = resolve('exact_n', HEIST, commitsWithCounts({ GUARD: 9 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
    expect(r.outcome.verdict).toContain('Nobody touched the vault');
  });
});
