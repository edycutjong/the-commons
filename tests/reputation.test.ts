import { describe, expect, it } from 'vitest';
import { decayScore, reputationDelta, type PerUserResult } from '../src/shared/payoffs';

const result = (choice: string, outcomeClass: PerUserResult['outcomeClass'], note = ''): PerUserResult => ({
  userId: 't2_x',
  username: 'x',
  choice,
  stake: 10,
  delta: outcomeClass === 'win' ? 10 : outcomeClass === 'loss' ? -10 : 0,
  outcomeClass,
  note,
});

describe('reputation deltas (pure)', () => {
  it('cooperative choice earns saint +10, +5 more when the commons won', () => {
    expect(reputationDelta('public_pot', true, result('FEED', 'win'))).toEqual({
      saint: 15,
      serpent: 0,
    });
    expect(reputationDelta('public_pot', false, result('FEED', 'loss'))).toEqual({
      saint: 10,
      serpent: 0,
    });
  });

  it('conviction is scored, not luck: a burned feeder still earns saint', () => {
    const r = reputationDelta('public_pot', false, result('FEED', 'loss', 'burned_faithful'));
    expect(r.saint).toBe(10);
  });

  it('profitable betrayal earns serpent +10 (+5 when the commons lost)', () => {
    expect(reputationDelta('public_pot', true, result('HOARD', 'win', 'freerode'))).toEqual({
      saint: 0,
      serpent: 10,
    });
    expect(reputationDelta('exact_n', false, result('HEIST', 'win', 'vault_cracked'))).toEqual({
      saint: 0,
      serpent: 15,
    });
  });

  it('unprofitable betrayal earns nothing — losers get no fangs', () => {
    expect(reputationDelta('public_pot', false, result('HOARD', 'loss'))).toEqual({
      saint: 0,
      serpent: 0,
    });
    expect(reputationDelta('chicken', false, result('DARE', 'loss', 'crashed'))).toEqual({
      saint: 0,
      serpent: 0,
    });
  });

  it('the safe hare is a profitable defection (serpent +10)', () => {
    expect(reputationDelta('stag_hunt', false, result('HARE', 'win', 'safe_hare'))).toEqual({
      saint: 0,
      serpent: 10,
    });
  });

  it('lowest-unique winners pay the cunning tax only (+5 serpent, no saint)', () => {
    expect(
      reputationDelta('lowest_unique', false, result('BID_3', 'win', 'unique_winner'))
    ).toEqual({ saint: 0, serpent: 5 });
    expect(reputationDelta('lowest_unique', false, result('BID_1', 'loss', 'outbid'))).toEqual({
      saint: 0,
      serpent: 0,
    });
  });

  it('weekly decay floors toward zero and never goes negative', () => {
    expect(decayScore(100, 0.8)).toBe(80);
    expect(decayScore(1, 0.8)).toBe(0);
    expect(decayScore(0, 0.8)).toBe(0);
    expect(decayScore(55, 0.8)).toBe(44);
  });
});
