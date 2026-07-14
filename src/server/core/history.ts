/**
 * Post-settle history. Reads ONLY `outcome:{day}` (written at settle) and
 * round metadata — open rounds are structurally absent from this projection,
 * and void rounds surface as verdict stubs with their commits still sealed
 * forever. (Invariant I1: nothing pre-settle is observable here.)
 */

import type { Deps } from './deps';
import { K, OUTCOME_SUMMARY_FIELD, outcomeUserField } from './keys';
import { parseRound } from './rounds';
import type { HistoryEntry, MyResultView, OutcomeSummaryView } from '../../shared/api';

export async function getHistory(
  deps: Deps,
  opts: { meUserId: string | null; limit: number }
): Promise<HistoryEntry[]> {
  const limit = Math.max(1, Math.min(30, opts.limit));
  const days = await deps.redis.zRange(K.roundIndex, 0, -1, { by: 'rank', reverse: true });

  const entries: HistoryEntry[] = [];
  for (const { member } of days) {
    if (entries.length >= limit) break;
    const day = Number.parseInt(member, 10);
    if (Number.isNaN(day)) continue;

    const roundRaw = await deps.redis.hGetAll(K.round(day));
    if (!roundRaw || Object.keys(roundRaw).length === 0) continue;
    const round = parseRound(roundRaw);
    if (!round) continue;

    if (round.state === 'void') {
      entries.push({ outcome: voidSummary(round.day, round.title, round.preseason), mine: null });
      continue;
    }
    if (round.state !== 'settled') continue; // open rounds NEVER appear here

    const summaryRaw = await deps.redis.hGet(K.outcome(day), OUTCOME_SUMMARY_FIELD);
    if (!summaryRaw) continue;
    let summary: OutcomeSummaryView;
    try {
      summary = JSON.parse(summaryRaw) as OutcomeSummaryView;
    } catch {
      continue;
    }

    let mine: MyResultView | null = null;
    if (opts.meUserId) {
      const mineRaw = await deps.redis.hGet(K.outcome(day), outcomeUserField(opts.meUserId));
      if (mineRaw) {
        try {
          mine = JSON.parse(mineRaw) as MyResultView;
        } catch {
          mine = null;
        }
      }
    }
    entries.push({ outcome: summary, mine });
  }
  return entries;
}

function voidSummary(day: number, title: string, preseason: boolean): OutcomeSummaryView {
  return {
    day,
    title,
    flavor: '',
    archetype: 'public_pot',
    params: {},
    participants: 0,
    pot: 0,
    split: {},
    splitPct: {},
    groupOutcome: 'void',
    verdict: 'Round voided by the moderators. The envelopes stay sealed forever.',
    detail: 'No payouts, no reveal.',
    saints: [],
    serpents: [],
    preseason,
    author: null,
    settledAt: 0,
  };
}
