/**
 * Pure payoff-engine types. Nothing in this module may touch I/O, Date.now(),
 * Math.random(), redis, or Reddit — resolution is a pure function of
 * (archetype, params, commits, seed).
 */

export type Archetype =
  | 'public_pot'
  | 'stag_hunt'
  | 'chicken'
  | 'lowest_unique'
  | 'exact_n';

export const ARCHETYPES: readonly Archetype[] = [
  'public_pot',
  'stag_hunt',
  'chicken',
  'lowest_unique',
  'exact_n',
] as const;

/** Numeric archetype parameters (validated/clamped against payoffs.json sliders). */
export type Params = Record<string, number>;

/** One sealed commit as seen by the settle pass. */
export type EngineCommit = {
  userId: string;
  username: string;
  choice: string;
  /** Season points pledged. Integer >= 0. */
  stake: number;
};

export type OutcomeClass = 'win' | 'loss' | 'push';

export type PerUserResult = {
  userId: string;
  username: string;
  choice: string;
  stake: number;
  /** Net season-point change from the dilemma itself (participation reward applied later). */
  delta: number;
  outcomeClass: OutcomeClass;
  /** Engine annotation, e.g. 'burned', 'freerode', 'unique_winner'. */
  note: string;
};

export type GroupOutcome = 'triumph' | 'ruin' | 'mixed' | 'void';

export type Resolution = {
  outcome: {
    archetype: Archetype;
    participants: number;
    /** Sum of all stakes. */
    pot: number;
    /** Post-settle public data: how many chose each option. */
    split: Record<string, number>;
    /** Same, as percentages with one decimal (display-stable). */
    splitPct: Record<string, number>;
    groupOutcome: GroupOutcome;
    /** True when the cooperative bloc "won" (used for reputation bonuses). */
    groupGood: boolean;
    /** One-line verdict, e.g. "58.0% hoarded. The pot burned." */
    verdict: string;
    /** Deterministic detail line for the reveal card. */
    detail: string;
  };
  perUser: PerUserResult[];
};

export type ArchetypeSpec = {
  label: string;
  choices: string[];
  cooperative: string | null;
  defaults: Params;
  sliders: Record<string, { min: number; max: number; step: number; label: string }>;
};

export type Economy = {
  startingPoints: number;
  participationReward: number;
  insuranceCost: number;
  maxStake: number;
  weeklyDecay: number;
};
