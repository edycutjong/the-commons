/**
 * The five dilemma archetypes, one resolver each.
 *
 * DESIGN RULES (invariants I1/I3 depend on these):
 *  - Pure functions of (params, commits). No randomness, no clocks.
 *  - All thresholds are PERCENT-based, so the outcome class depends only on
 *    the proportions of choices — identical drama at 8 or 8,000 players.
 *  - All deltas are integers (deterministic Math.round on multiplier math).
 *  - Threshold comparisons use a fixed epsilon so 0.7 means 0.7 whether it
 *    arrived as 0.7 or 0.6999999999 through float arithmetic.
 */

import type { EngineCommit, GroupOutcome, Params, PerUserResult } from './types';
import { param } from './params';

export const EPS = 1e-9;

export type ArchetypeResolution = {
  perUser: PerUserResult[];
  groupOutcome: GroupOutcome;
  groupGood: boolean;
  verdict: string;
  detail: string;
};

const pct = (frac: number): string => `${(frac * 100).toFixed(1)}%`;

function count(commits: EngineCommit[], choice: string): number {
  return commits.reduce((n, c) => (c.choice === choice ? n + 1 : n), 0);
}

function frac(commits: EngineCommit[], choice: string): number {
  /* v8 ignore next -- resolve() (the only caller path into the resolvers that use frac) short-circuits to a 'void' outcome before ever invoking a resolver when commits is empty, so the 0-length branch here is structurally unreachable in production */
  return commits.length === 0 ? 0 : count(commits, choice) / commits.length;
}

/** Deterministic integer gain: stake × (mult − 1), rounded half away from zero. */
export function gain(stake: number, mult: number): number {
  const raw = stake * (mult - 1);
  return raw >= 0 ? Math.round(raw) : -Math.round(-raw);
}

/** Deterministic integer loss (positive number): stake × fracLost. */
export function loss(stake: number, fracLost: number): number {
  return Math.round(stake * fracLost);
}

function classify(delta: number): PerUserResult['outcomeClass'] {
  return delta > 0 ? 'win' : delta < 0 ? 'loss' : 'push';
}

function result(c: EngineCommit, delta: number, note: string): PerUserResult {
  return {
    userId: c.userId,
    username: c.username,
    choice: c.choice,
    stake: c.stake,
    delta,
    outcomeClass: classify(delta),
    note,
  };
}

// ---------------------------------------------------------------------------
// 1. PUBLIC POT — threshold multiply/burn
//    If feedFrac >= threshold: feeders ×feedMult, hoarders ×hoardMult (the
//    freeride pays better — that is the dilemma). Otherwise the pot burns and
//    every stake is lost.
// ---------------------------------------------------------------------------
export function resolvePublicPot(params: Params, commits: EngineCommit[]): ArchetypeResolution {
  const threshold = param(params, 'threshold', 0.7);
  const feedMult = param(params, 'feedMult', 2);
  const hoardMult = param(params, 'hoardMult', 3);
  const feedFrac = frac(commits, 'FEED');
  const hoardFrac = frac(commits, 'HOARD');
  const survived = feedFrac >= threshold - EPS;

  if (survived) {
    return {
      perUser: commits.map((c) =>
        c.choice === 'FEED'
          ? result(c, gain(c.stake, feedMult), 'fed_pot')
          : result(c, gain(c.stake, hoardMult), 'freerode')
      ),
      groupOutcome: 'triumph',
      groupGood: true,
      verdict: `${pct(feedFrac)} fed. The pot held — every stake multiplied.`,
      detail: `Feed line ${pct(threshold)} · feeders ×${feedMult} · hoarders ×${hoardMult}.`,
    };
  }
  return {
    perUser: commits.map((c) =>
      result(c, -c.stake, c.choice === 'FEED' ? 'burned_faithful' : 'burned_greedy')
    ),
    groupOutcome: 'ruin',
    groupGood: false,
    verdict: `${pct(hoardFrac)} hoarded. The pot burned.`,
    detail: `Needed ${pct(threshold)} feeding — got ${pct(feedFrac)}. Every stake burned.`,
  };
}

// ---------------------------------------------------------------------------
// 2. STAG HUNT — all-or-nothing cooperation
//    Hares always bank a small sure gain. Stags win big only if enough of the
//    commons held the line; otherwise the hunt fails and stags lose everything.
// ---------------------------------------------------------------------------
export function resolveStagHunt(params: Params, commits: EngineCommit[]): ArchetypeResolution {
  const threshold = param(params, 'threshold', 0.8);
  const stagMult = param(params, 'stagMult', 3);
  const hareMult = param(params, 'hareMult', 1.5);
  const stagFrac = frac(commits, 'STAG');
  const hunted = stagFrac >= threshold - EPS;

  const perUser = commits.map((c) => {
    if (c.choice === 'HARE') return result(c, gain(c.stake, hareMult), 'safe_hare');
    return hunted
      ? result(c, gain(c.stake, stagMult), 'stag_feast')
      : result(c, -c.stake, 'hunt_failed');
  });
  return hunted
    ? {
        perUser,
        groupOutcome: 'triumph',
        groupGood: true,
        verdict: `${pct(stagFrac)} held the line. The stag fell.`,
        detail: `Hunt line ${pct(threshold)} · stags ×${stagMult} · hares ×${hareMult}.`,
      }
    : {
        perUser,
        groupOutcome: 'ruin',
        groupGood: false,
        verdict: `The hunt failed — only ${pct(stagFrac)} held the line.`,
        detail: `Needed ${pct(threshold)} on the stag. The hares ate anyway.`,
      };
}

// ---------------------------------------------------------------------------
// 3. CHICKEN — last to swerve
//    If daring stays at or under the crash line, darers profit big and
//    swervers bank small. One dare too many and the road runs red: darers
//    lose their stakes, swervers merely keep theirs.
// ---------------------------------------------------------------------------
export function resolveChicken(params: Params, commits: EngineCommit[]): ArchetypeResolution {
  const crashFrac = param(params, 'crashFrac', 0.5);
  const dareMult = param(params, 'dareMult', 3);
  const swerveMult = param(params, 'swerveMult', 1.25);
  const dareShare = frac(commits, 'DARE');
  const crashed = dareShare > crashFrac + EPS;

  const perUser = commits.map((c) => {
    if (c.choice === 'DARE') {
      return crashed
        ? result(c, -c.stake, 'crashed')
        : result(c, gain(c.stake, dareMult), 'dared_and_won');
    }
    return crashed
      ? result(c, 0, 'swerved_survived')
      : result(c, gain(c.stake, swerveMult), 'swerved_paid');
  });
  return crashed
    ? {
        perUser,
        groupOutcome: 'ruin',
        groupGood: false,
        verdict: `${pct(dareShare)} dared. The road ran red.`,
        detail: `Crash line ${pct(crashFrac)}. Darers burned their stakes; swervers kept theirs.`,
      }
    : {
        perUser,
        groupOutcome: 'triumph',
        groupGood: true,
        verdict: `${pct(dareShare)} dared — under the line. The daring walked away rich.`,
        detail: `Crash line ${pct(crashFrac)} · darers ×${dareMult} · swervers ×${swerveMult}.`,
      };
}

// ---------------------------------------------------------------------------
// 4. LOWEST UNIQUE BID — the quiet number takes it
//    Winner bid = the bid with the SMALLEST nonzero share (ties broken by the
//    lower bid). This is the percent-invariant generalization of "lowest
//    unique bid": at 8 players the rarest bid IS the unique bid; at 8,000 the
//    same proportions crown the same number. Winners multiply, losers burn a
//    fraction of their stake.
// ---------------------------------------------------------------------------
export function resolveLowestUnique(params: Params, commits: EngineCommit[]): ArchetypeResolution {
  const maxBid = Math.max(2, Math.round(param(params, 'maxBid', 5)));
  const winMult = param(params, 'winMult', 4);
  const loseFrac = param(params, 'loseFrac', 0.5);

  const counts = new Map<number, number>();
  for (const c of commits) {
    const bid = bidValue(c.choice);
    if (bid === null || bid < 1 || bid > maxBid) continue;
    counts.set(bid, (counts.get(bid) ?? 0) + 1);
  }
  let winner: number | null = null;
  let winnerCount = Infinity;
  for (let bid = 1; bid <= maxBid; bid++) {
    const n = counts.get(bid) ?? 0;
    if (n > 0 && n < winnerCount) {
      winner = bid;
      winnerCount = n;
    }
  }

  const total = commits.length;
  const winShare = winner !== null && total > 0 ? winnerCount / total : 0;
  const perUser = commits.map((c) => {
    const bid = bidValue(c.choice);
    if (winner !== null && bid === winner) {
      return result(c, gain(c.stake, winMult), 'unique_winner');
    }
    return result(c, -loss(c.stake, loseFrac), 'outbid');
  });
  return {
    perUser,
    groupOutcome: 'mixed',
    groupGood: false,
    verdict:
      winner === null
        ? 'No valid bids. The ledger stays blank.'
        : `BID ${winner} — held by only ${pct(winShare)} — takes it.`,
    detail:
      winner === null
        ? 'Nobody bid inside the table.'
        : `Rarest bid wins (ties go low). Winners ×${winMult}; the rest burn ${pct(loseFrac)} of stake.`,
  };
}

function bidValue(choice: string): number | null {
  const m = /^BID_(\d+)$/.exec(choice);
  /* v8 ignore next -- when the regex matches, \d+ always captured at least one digit, so m[1] can never be undefined here; only the !m half of this guard is reachable */
  if (!m || m[1] === undefined) return null;
  return Number.parseInt(m[1], 10);
}

// ---------------------------------------------------------------------------
// 5. EXACT-N HEIST — the vault opens for a crew of exactly ~N%
//    If the heist share lands inside [targetFrac − band, targetFrac + band],
//    the crew multiplies and the guards eat a small loss. Any other share and
//    the alarm trips: heisters lose their stakes, guards collect a bounty.
// ---------------------------------------------------------------------------
export function resolveExactN(params: Params, commits: EngineCommit[]): ArchetypeResolution {
  const targetFrac = param(params, 'targetFrac', 0.125);
  const band = param(params, 'band', 0.05);
  const heistMult = param(params, 'heistMult', 5);
  const guardMult = param(params, 'guardMult', 1.5);
  const heistShare = frac(commits, 'HEIST');
  const anyHeist = count(commits, 'HEIST') > 0;
  const inside = anyHeist && Math.abs(heistShare - targetFrac) <= band + EPS;

  const perUser = commits.map((c) => {
    if (c.choice === 'HEIST') {
      return inside
        ? result(c, gain(c.stake, heistMult), 'vault_cracked')
        : result(c, -c.stake, 'alarm_tripped');
    }
    return inside
      ? result(c, -loss(c.stake, 0.25), 'guarded_robbed')
      : result(c, gain(c.stake, guardMult), 'guard_bounty');
  });
  return inside
    ? {
        perUser,
        groupOutcome: 'mixed',
        groupGood: false,
        verdict: `The vault opened. A crew of ${pct(heistShare)} walked out rich.`,
        detail: `The plan needed ${pct(targetFrac)} ±${pct(band)}. It got exactly that.`,
      }
    : {
        perUser,
        groupOutcome: anyHeist ? 'mixed' : 'triumph',
        groupGood: true,
        verdict: anyHeist
          ? `The alarm tripped — ${pct(heistShare)} reached for the vault.`
          : 'Nobody touched the vault. The guards split the bounty.',
        detail: `The plan needed ${pct(targetFrac)} ±${pct(band)}. Guards collected ×${guardMult}.`,
      };
}
