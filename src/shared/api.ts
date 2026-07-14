/**
 * Client-facing API contract.
 *
 * SEALED-COMMIT PROTOCOL (invariant I1): the types in this file are the
 * whole story of what a client may ever learn before a settle. Note what is
 * ABSENT from `RoundView`: no split, no per-choice counts, no per-user
 * choices, no aggregates other than participation count and pot size.
 * tests/endpoints.test.ts asserts these shapes key-by-key.
 */

import type { Archetype, GroupOutcome, OutcomeClass, Params } from './payoffs/types';

// --- pre-settle -------------------------------------------------------------

export type RoundView = {
  state: 'open' | 'interlude' | 'void';
  day: number;
  title: string;
  flavor: string;
  archetype: Archetype;
  params: Params; // payoff structure is PUBLIC — only the split is sealed
  choices: string[];
  /** Live count of sealed envelopes. Never the split. */
  participants: number;
  /** Sum of pledged stakes. Never who pledged what. */
  pot: number;
  /** Unix ms when the settle cron fires (next 00:00 UTC). */
  revealAt: number;
  preseason: boolean;
  author: string | null;
  postId: string | null;
};

export type MeView = {
  loggedIn: boolean;
  username: string | null;
  /** My own sealed commit (mine to see — never anyone else's). */
  myCommit: { choice: string; stake: number; insured: boolean } | null;
  balance: number;
  maxStake: number;
  insuranceCost: number;
  insuranceHeld: boolean;
  streak: { current: number; best: number };
  saintScore: number;
  serpentScore: number;
};

export type RoundResponse = {
  type: 'round';
  round: RoundView | null; // null = nothing open yet (pre-first-round install)
  me: MeView;
  lastSettledDay: number | null;
  serverNow: number;
};

export type CommitRequest = {
  choice: string;
  stake: number;
  buyInsurance?: boolean;
};

export type CommitResponse = {
  type: 'commit';
  status: 'sealed';
  day: number;
  choice: string;
  stake: number;
  insured: boolean;
  participants: number;
  pot: number;
  revealAt: number;
};

export type ApiError = {
  status: 'error';
  code:
    | 'not_logged_in'
    | 'no_round'
    | 'round_sealed'
    | 'already_committed'
    | 'bad_choice'
    | 'bad_stake'
    | 'insufficient_points'
    // commit-vs-settle race: the envelope sealed underneath a live commit
    | 'conflict'
    | 'filter_rejected'
    | 'bad_request'
    | 'internal';
  message: string;
};

// --- post-settle ------------------------------------------------------------

export type OutcomeSummaryView = {
  day: number;
  title: string;
  flavor: string;
  archetype: Archetype;
  params: Params;
  participants: number;
  pot: number;
  split: Record<string, number>;
  splitPct: Record<string, number>;
  groupOutcome: GroupOutcome;
  verdict: string;
  detail: string;
  saints: string[];
  serpents: string[];
  preseason: boolean;
  author: string | null;
  settledAt: number;
};

export type MyResultView = {
  day: number;
  choice: string;
  stake: number;
  delta: number;
  outcomeClass: OutcomeClass;
  note: string;
  insuranceSaved: boolean;
  streakAfter: number;
};

export type HistoryEntry = {
  outcome: OutcomeSummaryView;
  mine: MyResultView | null;
};

export type HistoryResponse = {
  type: 'history';
  entries: HistoryEntry[]; // newest first, settled/void rounds only
};

// --- forge ------------------------------------------------------------------

export type ForgeRequest = {
  archetype: Archetype;
  params: Params;
  title: string;
  flavor: string;
};

export type ForgeResponse = {
  type: 'forge';
  status: 'queued';
  position: number;
};

// --- ladders ----------------------------------------------------------------

export type LadderRow = { username: string; score: number; rank: number };

export type LaddersResponse = {
  type: 'ladders';
  saint: LadderRow[];
  serpent: LadderRow[];
  season: LadderRow[];
  weeklyDecay: number;
};

// --- realtime ---------------------------------------------------------------

/** The ONLY payload ever broadcast pre-settle: two integers. */
export type PotTickerMessage = {
  participants: number;
  pot: number;
};

export const POT_TICKER_CHANNEL = 'pot_ticker';
