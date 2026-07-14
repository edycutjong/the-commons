/**
 * The midnight settle — ONE idempotent watch/multi/exec pass (invariant I3).
 *
 *   WATCH round:{day} + commit:{day}
 *   read round (state guard: only 'open' settles — re-running is a no-op)
 *   read commits, resolve() the pure payoff engine, fold pure updaters
 *   MULTI: outcome hash · streak hashes · absolute zAdds (season/saint/serpent)
 *          · round.state = settled · settled:last · drop display pot
 *   EXEC → null means a commit raced us; we retry with the fresh commit set.
 *
 * Everything queued in the MULTI is an ABSOLUTE value computed from reads
 * taken under the WATCH, so the transaction either applies exactly once or
 * not at all. A crashed settle can be re-run forever (scheduler retry, Force
 * Settle menu) and produces byte-identical outcomes — the engine is a pure
 * function of (commits, params) and `settledAt` is pinned by the caller for
 * seeded rounds.
 */

import type { Deps } from './deps';
import { K, OUTCOME_SUMMARY_FIELD, outcomeUserField } from './keys';
import { parseRound, type RoundRecord } from './rounds';
import { parseStoredCommit } from './commits';
import type { MyResultView, OutcomeSummaryView } from '../../shared/api';
import {
  ECONOMY,
  applyNightToBalance,
  effectiveBalance,
  parseStreak,
  reputationDelta,
  resolve,
  serializeStreak,
  updateStreak,
  type EngineCommit,
  type Resolution,
} from '../../shared/payoffs';

export type SettleOutcome =
  | { status: 'settled'; round: RoundRecord; summary: OutcomeSummaryView; resolution: Resolution }
  | { status: 'already'; day: number }
  | { status: 'void'; day: number }
  | { status: 'no_round'; day: number };

const MAX_ATTEMPTS = 6;
const READ_CHUNK = 50;

export async function settleRound(
  deps: Deps,
  day: number,
  opts?: { at?: number }
): Promise<SettleOutcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = await trySettle(deps, day, opts?.at);
    if (result !== 'conflict') return result;
  }
  throw new Error(`settle(${day}): conflict storm — exceeded ${MAX_ATTEMPTS} attempts`);
}

async function trySettle(
  deps: Deps,
  day: number,
  at?: number
): Promise<SettleOutcome | 'conflict'> {
  const tx = await deps.redis.watch(K.round(day), K.commit(day));

  const roundRaw = await deps.redis.hGetAll(K.round(day));
  if (!roundRaw || Object.keys(roundRaw).length === 0) {
    await tx.unwatch();
    return { status: 'no_round', day };
  }
  const round = parseRound(roundRaw);
  if (!round) {
    await tx.unwatch();
    return { status: 'no_round', day };
  }
  if (round.state === 'settled') {
    await tx.unwatch();
    return { status: 'already', day };
  }
  if (round.state === 'void') {
    await tx.unwatch();
    return { status: 'void', day };
  }

  // --- gather sealed commits (server-side only; first time they are read) ---
  const commitRaw = await deps.redis.hGetAll(K.commit(day));
  const commits: (EngineCommit & { insured: boolean })[] = [];
  for (const [userId, json] of Object.entries(commitRaw)) {
    const stored = parseStoredCommit(json);
    if (!stored) continue;
    commits.push({
      userId,
      username: stored.username,
      choice: stored.choice,
      stake: stored.stake,
      insured: stored.insured,
    });
  }
  /* v8 ignore next -- commits are keyed by unique Redis hash fields (userId), so two entries can never compare equal here; the tie-break (: 0) branch is structurally unreachable */
  commits.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));

  // --- pure resolution -------------------------------------------------------
  const resolution = resolve(round.archetype, round.params, commits, `round-${day}`);

  // --- batch reads for the pure updaters -------------------------------------
  const streaks = new Map<string, ReturnType<typeof parseStreak>>();
  const balances = new Map<string, number>();
  const saintScores = new Map<string, number>();
  const serpentScores = new Map<string, number>();

  for (let i = 0; i < commits.length; i += READ_CHUNK) {
    const chunk = commits.slice(i, i + READ_CHUNK);
    await Promise.all(
      chunk.map(async (c) => {
        const [streakRaw, balance, saint, serpent] = await Promise.all([
          deps.redis.hGetAll(K.streak(c.userId)),
          deps.redis.zScore(K.seasonPoints, c.username),
          deps.redis.zScore(K.repSaint, c.username),
          deps.redis.zScore(K.repSerpent, c.username),
        ]);
        streaks.set(c.userId, parseStreak(streakRaw));
        balances.set(c.username, effectiveBalance(balance, ECONOMY));
        saintScores.set(c.username, saint ?? 0);
        serpentScores.set(c.username, serpent ?? 0);
      })
    );
  }

  // --- fold pure updaters -----------------------------------------------------
  const insuredSet = new Set(commits.filter((c) => c.insured).map((c) => c.userId));
  const perUserFields: Record<string, string> = {};
  const streakWrites: { userId: string; fields: Record<string, string> }[] = [];
  const seasonMembers: { member: string; score: number }[] = [];
  const saintMembers: { member: string; score: number }[] = [];
  const serpentMembers: { member: string; score: number }[] = [];
  const saintDeltas: { username: string; delta: number }[] = [];
  const serpentDeltas: { username: string; delta: number }[] = [];

  for (const result of resolution.perUser) {
    /* v8 ignore next -- resolve() derives perUser 1:1 from the same `commits` array the batch-read loop above just populated `streaks` from, so every result.userId is always a key in that map; the ?? fallback is structurally unreachable */
    const prevStreak = streaks.get(result.userId) ?? parseStreak(null);
    // The engine does not know about insurance; the ledger does.
    const held = insuredSet.has(result.userId) ? 1 : prevStreak.insuranceHeld;
    const streakUpdate = updateStreak({ ...prevStreak, insuranceHeld: held as 0 | 1 }, day, result.outcomeClass);
    streakWrites.push({ userId: result.userId, fields: serializeStreak(streakUpdate.next) });

    /* v8 ignore next -- same argument as above: balances was populated for every c.username in the identical commits array, so this ?? fallback is structurally unreachable */
    const prevBalance = balances.get(result.username) ?? ECONOMY.startingPoints;
    const nextBalance = applyNightToBalance(prevBalance, result.delta, ECONOMY);
    seasonMembers.push({ member: result.username, score: nextBalance });

    const rep = reputationDelta(round.archetype, resolution.outcome.groupGood, result);
    if (rep.saint > 0) {
      saintMembers.push({
        member: result.username,
        /* v8 ignore next -- saintScores was populated (defaulting to 0) for every username in this same commits batch above, so this map entry is always defined; the ?? fallback is structurally unreachable */
        score: (saintScores.get(result.username) ?? 0) + rep.saint,
      });
      saintDeltas.push({ username: result.username, delta: rep.saint });
    }
    if (rep.serpent > 0) {
      serpentMembers.push({
        member: result.username,
        /* v8 ignore next -- same argument: serpentScores was populated for every username in this batch, so this map entry is always defined; the ?? fallback is structurally unreachable */
        score: (serpentScores.get(result.username) ?? 0) + rep.serpent,
      });
      serpentDeltas.push({ username: result.username, delta: rep.serpent });
    }

    const mine: MyResultView = {
      day,
      choice: result.choice,
      stake: result.stake,
      delta: result.delta,
      outcomeClass: result.outcomeClass,
      note: result.note,
      insuranceSaved: streakUpdate.insuranceSaved,
      streakAfter: streakUpdate.next.current,
    };
    perUserFields[outcomeUserField(result.userId)] = JSON.stringify(mine);
  }

  const byDeltaThenName = (
    a: { username: string; delta: number },
    b: { username: string; delta: number }
  ) => b.delta - a.delta || (a.username < b.username ? -1 : 1);

  const settledAt = at ?? deps.now();
  const summary: OutcomeSummaryView = {
    day,
    title: round.title,
    flavor: round.flavor,
    archetype: round.archetype,
    params: round.params,
    participants: resolution.outcome.participants,
    pot: resolution.outcome.pot,
    split: resolution.outcome.split,
    splitPct: resolution.outcome.splitPct,
    groupOutcome: resolution.outcome.groupOutcome,
    verdict: resolution.outcome.verdict,
    detail: resolution.outcome.detail,
    saints: saintDeltas.sort(byDeltaThenName).slice(0, 3).map((s) => s.username),
    serpents: serpentDeltas.sort(byDeltaThenName).slice(0, 3).map((s) => s.username),
    preseason: round.preseason,
    author: round.author,
    settledAt,
  };

  // --- the single atomic write ------------------------------------------------
  await tx.multi();
  await tx.hSet(K.outcome(day), {
    [OUTCOME_SUMMARY_FIELD]: JSON.stringify(summary),
    ...perUserFields,
  });
  for (const write of streakWrites) {
    await tx.hSet(K.streak(write.userId), write.fields);
  }
  if (seasonMembers.length > 0) await tx.zAdd(K.seasonPoints, ...seasonMembers);
  if (saintMembers.length > 0) await tx.zAdd(K.repSaint, ...saintMembers);
  if (serpentMembers.length > 0) await tx.zAdd(K.repSerpent, ...serpentMembers);
  await tx.hSet(K.round(day), {
    state: 'settled',
    settledAt: String(settledAt),
    pot: String(resolution.outcome.pot),
    participants: String(resolution.outcome.participants),
  });
  await tx.set(K.settledLast, String(day));
  await tx.del(K.pot(day));
  const results = await tx.exec();
  if (results === null) return 'conflict';

  const settledRound: RoundRecord = { ...round, state: 'settled', settledAt };
  return { status: 'settled', round: settledRound, summary, resolution };
}

/** Reckoning comment body for the day's post (posted by the settle cron). */
export function reckoningText(summary: OutcomeSummaryView): string {
  const lines: string[] = [];
  lines.push(`**THE RECKONING — ${summary.title}**`);
  lines.push('');
  lines.push(`> ${summary.verdict}`);
  lines.push('');
  lines.push(`${summary.participants} souls committed. Pot: ${summary.pot}.`);
  const splitLine = Object.entries(summary.split)
    /* v8 ignore next -- resolve() builds split and splitPct from the exact same choice keys in the same pass, so splitPct[choice] is always defined for every key of split; the ?? fallback is structurally unreachable */
    .map(([choice, n]) => `${choice} ${n} (${summary.splitPct[choice] ?? 0}%)`)
    .join(' · ');
  lines.push(`Split: ${splitLine}`);
  if (summary.saints.length > 0) {
    lines.push(`Saints of the night: ${summary.saints.map((s) => `u/${s}`).join(', ')}`);
  }
  if (summary.serpents.length > 0) {
    lines.push(`Serpents of the night: ${summary.serpents.map((s) => `u/${s}`).join(', ')}`);
  }
  lines.push('');
  lines.push('_Tonight’s dilemma is already open. The envelope waits._');
  return lines.join('\n');
}
