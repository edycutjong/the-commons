/**
 * Pure reputation updaters — the consequence ladders.
 *
 * Saint score rewards choosing the cooperative option (conviction is scored,
 * not luck): +10 for the cooperative choice, +5 bonus when the commons
 * actually won the night. Serpent score rewards PROFITABLE betrayal: +10 when
 * a non-cooperative choice ends the night in profit, +5 bonus when that
 * profit was carved out of a losing commons (the heist case), and +5 for a
 * lowest-unique win (cunning, not betrayal — the ladder is wry about it).
 */

import type { Archetype, PerUserResult } from './types';
import { archetypeSpec } from './params';

export type RepDelta = { saint: number; serpent: number };

export function reputationDelta(
  archetype: Archetype,
  groupGood: boolean,
  result: PerUserResult
): RepDelta {
  const spec = archetypeSpec(archetype);
  const cooperative = spec.cooperative;
  let saint = 0;
  let serpent = 0;

  if (cooperative !== null && result.choice === cooperative) {
    saint += 10;
    if (groupGood) saint += 5;
  } else if (cooperative !== null) {
    // A defection. Serpents only earn on PROFITABLE betrayal.
    if (result.outcomeClass === 'win') {
      serpent += 10;
      // The extra fang is the HEIST case: profit carved directly out of a
      // losing commons (exact_n). A safe hare that merely sidesteps a failed
      // hunt is a milder defection — it does not prey on the cooperators.
      if (!groupGood && archetype === 'exact_n') serpent += 5;
    }
  } else if (archetype === 'lowest_unique' && result.note === 'unique_winner') {
    serpent += 5; // cunning tax
  }

  return { saint, serpent };
}

/** Weekly decay: scores multiply by `factor` and floor toward zero. */
export function decayScore(score: number, factor: number): number {
  const decayed = Math.floor(score * factor);
  return decayed < 0 ? 0 : decayed;
}
