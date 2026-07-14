import { describe, expect, it } from 'vitest';
import { resolve, defaultParams, gain } from '../src/shared/payoffs';
import { commitsWithCounts } from './helpers/synth';

const STAG = defaultParams('stag_hunt'); // threshold 0.8, stagMult 3, hareMult 1.5
const CHICKEN = defaultParams('chicken'); // crashFrac 0.5, dareMult 3, swerveMult 1.25

describe('stag hunt — all-or-nothing cooperation', () => {
  it('hunt succeeds at exactly the 80% line', () => {
    const r = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 8, HARE: 2 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
  });

  it('hunt fails one stag short', () => {
    const r = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 79, HARE: 21 }));
    expect(r.outcome.groupOutcome).toBe('ruin');
    expect(r.outcome.verdict).toContain('The hunt failed');
  });

  it('stags multiply x3 on success', () => {
    const r = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 9, HARE: 1 }));
    const stag = r.perUser.find((u) => u.choice === 'STAG')!;
    expect(stag.delta).toBe(2 * stag.stake);
  });

  it('stags lose their whole stake on failure', () => {
    const r = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 5, HARE: 5 }));
    for (const u of r.perUser.filter((x) => x.choice === 'STAG')) {
      expect(u.delta).toBe(-u.stake);
    }
  });

  it('hares always bank the safe gain, hunt or no hunt', () => {
    const success = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 9, HARE: 1 }));
    const failure = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 1, HARE: 9 }));
    for (const r of [success, failure]) {
      for (const u of r.perUser.filter((x) => x.choice === 'HARE')) {
        expect(u.delta).toBe(gain(u.stake, 1.5));
        expect(u.outcomeClass).toBe(u.stake > 0 ? 'win' : 'push');
      }
    }
  });

  it('all-stag night is a clean triumph', () => {
    const r = resolve('stag_hunt', STAG, commitsWithCounts({ STAG: 12 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
    expect(r.perUser.every((u) => u.outcomeClass === 'win')).toBe(true);
  });
});

describe('chicken — last to swerve', () => {
  it('exactly at the crash line nobody crashes (> semantics)', () => {
    const r = resolve('chicken', CHICKEN, commitsWithCounts({ DARE: 50, SWERVE: 50 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
  });

  it('one dare over the line crashes the road', () => {
    const r = resolve('chicken', CHICKEN, commitsWithCounts({ DARE: 51, SWERVE: 49 }));
    expect(r.outcome.groupOutcome).toBe('ruin');
    expect(r.outcome.verdict).toContain('The road ran red');
  });

  it('darers win x3 under the line', () => {
    const r = resolve('chicken', CHICKEN, commitsWithCounts({ DARE: 3, SWERVE: 7 }));
    const dare = r.perUser.find((u) => u.choice === 'DARE')!;
    expect(dare.delta).toBe(2 * dare.stake);
    expect(dare.note).toBe('dared_and_won');
  });

  it('darers lose everything in a crash; swervers merely keep their stake', () => {
    const r = resolve('chicken', CHICKEN, commitsWithCounts({ DARE: 8, SWERVE: 2 }));
    for (const u of r.perUser) {
      if (u.choice === 'DARE') expect(u.delta).toBe(-u.stake);
      else {
        expect(u.delta).toBe(0);
        expect(u.outcomeClass).toBe('push');
      }
    }
  });

  it('swervers earn the small multiplier when the road holds', () => {
    const r = resolve('chicken', CHICKEN, commitsWithCounts({ DARE: 2, SWERVE: 8 }));
    for (const u of r.perUser.filter((x) => x.choice === 'SWERVE')) {
      expect(u.delta).toBe(gain(u.stake, 1.25));
    }
  });

  it('an all-swerve night still pays the cautious', () => {
    const r = resolve('chicken', CHICKEN, commitsWithCounts({ SWERVE: 6 }));
    expect(r.outcome.groupOutcome).toBe('triumph');
    expect(r.perUser.every((u) => u.delta >= 0)).toBe(true);
  });
});
