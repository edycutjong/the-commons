/**
 * The Commons payoff engine — resolve(archetype, params, commits) → Resolution.
 *
 * PURE. Built and unit-tested before any UI existed. The settle job, the
 * seed action and the bench harness all call exactly this function, so a
 * settled round is a pure function of (commits, params) — invariant I3.
 *
 * `seed` is accepted for forward-compatibility (seeded flourishes like the
 * weekly Wildcard) but the five archetype payoffs never draw randomness.
 */

import type { Archetype, EngineCommit, Params, Resolution } from './types';
import {
  resolveChicken,
  resolveExactN,
  resolveLowestUnique,
  resolvePublicPot,
  resolveStagHunt,
  type ArchetypeResolution,
} from './archetypes';
import { choicesFor } from './params';

export * from './types';
export * from './params';
export { EPS, gain, loss } from './archetypes';
export { seededRng, seededPick } from './rng';
export * from './streaks';
export * from './reputation';
export * from './economy';

const RESOLVERS: Record<Archetype, (p: Params, c: EngineCommit[]) => ArchetypeResolution> = {
  public_pot: resolvePublicPot,
  stag_hunt: resolveStagHunt,
  chicken: resolveChicken,
  lowest_unique: resolveLowestUnique,
  exact_n: resolveExactN,
};

export function resolve(
  archetype: Archetype,
  params: Params,
  commits: EngineCommit[],
  _seed?: string
): Resolution {
  // Deterministic input order regardless of hash-iteration order upstream.
  /* v8 ignore next -- commit userIds come from unique Redis hash-field keys, so two commits can never compare equal here; the tie-break (: 0) branch is structurally unreachable */
  const ordered = [...commits].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  if (ordered.length === 0) {
    return {
      outcome: {
        archetype,
        participants: 0,
        pot: 0,
        split: emptySplit(archetype),
        splitPct: emptySplit(archetype),
        groupOutcome: 'void',
        groupGood: false,
        verdict: 'Nobody committed. The night passes unjudged.',
        detail: 'Zero sealed envelopes at the reckoning.',
      },
      perUser: [],
    };
  }

  const resolver = RESOLVERS[archetype];
  const r = resolver(params, ordered);

  const split = emptySplit(archetype);
  for (const c of ordered) {
    if (Object.prototype.hasOwnProperty.call(split, c.choice)) {
      /* v8 ignore next -- emptySplit() pre-seeds every valid choice key to 0, and the hasOwnProperty guard above only lets valid choices through, so split[c.choice] is always a defined number here; the ?? 0 fallback is structurally unreachable */
      split[c.choice] = (split[c.choice] ?? 0) + 1;
    }
  }
  const splitPct: Record<string, number> = {};
  for (const [choice, n] of Object.entries(split)) {
    splitPct[choice] = Number(((n / ordered.length) * 100).toFixed(1));
  }
  const pot = ordered.reduce((sum, c) => sum + c.stake, 0);

  return {
    outcome: {
      archetype,
      participants: ordered.length,
      pot,
      split,
      splitPct,
      groupOutcome: r.groupOutcome,
      groupGood: r.groupGood,
      verdict: r.verdict,
      detail: r.detail,
    },
    perUser: r.perUser,
  };
}

function emptySplit(archetype: Archetype): Record<string, number> {
  const split: Record<string, number> = {};
  for (const choice of choicesFor(archetype)) split[choice] = 0;
  return split;
}
