import { describe, expect, it } from 'vitest';
import { checkFlavorText, checkTitle, normalizeForFilter } from '../src/shared/words';
import {
  ECONOMY,
  applyNightToBalance,
  clampParams,
  effectiveBalance,
  maxStakeFor,
  sanitizeStake,
} from '../src/shared/payoffs';

describe('forge wordlist filter', () => {
  it('accepts ordinary dramatic copy', () => {
    expect(checkFlavorText('The vault wants a crew of one in eight.').ok).toBe(true);
  });

  it('rejects empty and over-140-char text', () => {
    expect(checkFlavorText('').ok).toBe(false);
    expect(checkFlavorText('x'.repeat(141)).ok).toBe(false);
    expect(checkFlavorText('x'.repeat(140)).ok).toBe(true);
  });

  it('rejects multi-line and control characters', () => {
    expect(checkFlavorText('line one\nline two').ok).toBe(false);
    expect(checkFlavorText('tab\there').ok).toBe(false);
    expect(checkFlavorText('bell\u0007here').ok).toBe(false);
  });

  it('catches banned stems through leetspeak and separators', () => {
    expect(checkFlavorText('you are a r3t4rd').ok).toBe(false);
    expect(checkFlavorText('N-a-z-i pot night').ok).toBe(false);
    expect(checkFlavorText('k.y.s everyone').ok).toBe(false);
  });

  it('normalization collapses leet and strips non-letters', () => {
    expect(normalizeForFilter('R3-T4 rD!')).toBe('retardi'); // '!' maps to i
    expect(normalizeForFilter('hello world 13')).toBe('helloworldie'); // digits fold to letters
  });

  it('title shares the screen and adds its own 48-char cap', () => {
    expect(checkTitle('THE BLACKOUT POT').ok).toBe(true);
    expect(checkTitle('T'.repeat(49)).ok).toBe(false);
  });

  it('rejects an empty / whitespace-only title before delegating to the shared screen', () => {
    const empty = checkTitle('');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toContain('Title is required');
    expect(checkTitle('   ').ok).toBe(false);
  });

  it('rejects the extended-control-character range (0x7f-0x9f)', () => {
    expect(checkFlavorText('bad\u007fchar').ok).toBe(false); // DEL, 0x7f
    expect(checkFlavorText('bad\u0085char').ok).toBe(false); // NEL, 0x85
  });
});

describe('economy rules (pure)', () => {
  it('absent players have the virtual starting balance', () => {
    expect(effectiveBalance(undefined, ECONOMY)).toBe(100);
    expect(effectiveBalance(37, ECONOMY)).toBe(37);
  });

  it('stakes clamp to balance and the table max', () => {
    expect(maxStakeFor(500, ECONOMY)).toBe(50);
    expect(maxStakeFor(20, ECONOMY)).toBe(20);
    expect(sanitizeStake(999, 500, ECONOMY)).toBe(50);
    expect(sanitizeStake(15, 20, ECONOMY)).toBe(15);
    expect(sanitizeStake(15.9, 20, ECONOMY)).toBe(15);
    expect(sanitizeStake(-1, 20, ECONOMY)).toBe(null);
    expect(sanitizeStake('nope', 20, ECONOMY)).toBe(null);
  });

  it('night application adds the participation reward and floors at zero', () => {
    expect(applyNightToBalance(100, -20, ECONOMY)).toBe(85);
    expect(applyNightToBalance(10, -40, ECONOMY)).toBe(0);
    expect(applyNightToBalance(0, 0, ECONOMY)).toBe(5);
  });
});

describe('forge param clamping', () => {
  it('clamps to slider bounds and snaps to step', () => {
    const p = clampParams('public_pot', { threshold: 0.999, feedMult: 0.1, hoardMult: 3.26 });
    expect(p['threshold']).toBe(0.9);
    expect(p['feedMult']).toBe(1.5);
    expect(p['hoardMult']).toBe(3.5); // snapped to 0.5 grid
  });

  it('drops unknown keys and defaults missing ones', () => {
    const p = clampParams('stag_hunt', { evil: 666 });
    expect(p).toEqual({ threshold: 0.8, stagMult: 3, hareMult: 1.5 });
    expect('evil' in p).toBe(false);
  });

  it('is total: garbage in, defaults out', () => {
    expect(clampParams('chicken', null)).toEqual({ crashFrac: 0.5, dareMult: 3, swerveMult: 1.25 });
    expect(clampParams('chicken', 'lol')).toEqual({
      crashFrac: 0.5,
      dareMult: 3,
      swerveMult: 1.25,
    });
    expect(clampParams('chicken', { crashFrac: Number.NaN })['crashFrac']).toBe(0.5);
  });
});
