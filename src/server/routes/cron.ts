/**
 * Scheduler endpoints. `settle` at 00:00 UTC is the game clock; `open` at
 * 00:05 posts the next dilemma; `ceremony` runs Mondays 01:00.
 * All three are safe to re-run (idempotent settle; open no-ops when the day's
 * round exists; ceremony is guarded by its own week key semantics).
 */

import { Hono } from 'hono';
import type { Deps } from '../core/deps';
import { K } from '../core/keys';
import { getRound, nextDilemma, openRound } from '../core/rounds';
import { reckoningText, settleRound, type SettleOutcome } from '../core/settle';
import { weeklyCeremony } from '../core/ceremony';
import { createDayPost } from '../core/post';
import { dayOf } from '../core/time';

type TaskResult = { status: string; [key: string]: unknown };

export function makeCron(deps: Deps): Hono {
  const cron = new Hono();

  cron.post('/settle', async (c) => {
    const result = await runSettlePass(deps);
    return c.json<TaskResult>(result);
  });

  cron.post('/open', async (c) => {
    const day = dayOf(deps.now());
    const existing = await getRound(deps, day);
    if (existing) {
      return c.json<TaskResult>({ status: 'noop', reason: 'round exists', day });
    }
    const dilemma = await nextDilemma(deps, day);
    const postId = await createDayPost(deps, { title: dilemma.title, day });
    await openRound(deps, {
      day,
      archetype: dilemma.archetype,
      params: dilemma.params,
      title: dilemma.title,
      flavor: dilemma.flavor,
      author: dilemma.author,
      postId,
      openedAt: deps.now(),
      preseason: false,
    });
    return c.json<TaskResult>({ status: 'opened', day, postId });
  });

  cron.post('/ceremony', async (c) => {
    const result = await weeklyCeremony(deps);
    return c.json<TaskResult>({ status: 'ok', ...result });
  });

  return cron;
}

/**
 * Shared by the settle cron and the Force Settle menu action: settle the
 * pointed-at round, then post the Reckoning comment (best-effort — a failed
 * comment never un-settles anything; the settle itself already committed).
 */
export async function runSettlePass(deps: Deps): Promise<{ status: string; day?: number }> {
  const pointer = await deps.redis.get(K.roundCurrent);
  if (!pointer) return { status: 'noop' };
  const day = Number.parseInt(pointer, 10);
  if (Number.isNaN(day)) return { status: 'noop' };

  const outcome: SettleOutcome = await settleRound(deps, day);
  if (outcome.status === 'settled') {
    if (outcome.round.postId && !outcome.round.preseason) {
      try {
        const comment = await deps.reddit.submitComment({
          id: outcome.round.postId,
          text: reckoningText(outcome.summary),
        });
        await comment.distinguish(true);
      } catch (e) {
        console.error('Reckoning comment failed:', e);
      }
    }
    return { status: 'settled', day };
  }
  return { status: outcome.status, day };
}
