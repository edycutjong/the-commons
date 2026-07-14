/**
 * Dilemma Forge — constrained UGC. A submission is an archetype id, slider
 * params (clamped onto the payoffs.json grid) and ≤140 chars of wordlist-
 * filtered flavor. It sits in `forge:queue` until a moderator approves it,
 * at which point it moves to `forge:approved` and the next open-round cron
 * consumes it (author credited on the card).
 */

import type { Deps } from './deps';
import { K } from './keys';
import { clampParams, isArchetype } from '../../shared/payoffs';
import { checkFlavorText, checkTitle } from '../../shared/words';

export type ForgeSubmission = {
  id: string;
  archetype: string;
  params: Record<string, number>;
  title: string;
  flavor: string;
  author: string;
  ts: number;
};

export type ForgeSubmitResult =
  | { ok: true; position: number }
  | { ok: false; code: 'bad_request' | 'filter_rejected'; message: string };

export async function submitForge(
  deps: Deps,
  input: { author: string; archetype: unknown; params: unknown; title: unknown; flavor: unknown }
): Promise<ForgeSubmitResult> {
  if (typeof input.archetype !== 'string' || !isArchetype(input.archetype)) {
    return { ok: false, code: 'bad_request', message: 'Unknown archetype.' };
  }
  if (typeof input.title !== 'string' || typeof input.flavor !== 'string') {
    return { ok: false, code: 'bad_request', message: 'Title and flavor text are required.' };
  }
  const titleVerdict = checkTitle(input.title);
  if (!titleVerdict.ok) return { ok: false, code: 'filter_rejected', message: titleVerdict.reason };
  const flavorVerdict = checkFlavorText(input.flavor);
  if (!flavorVerdict.ok) {
    return { ok: false, code: 'filter_rejected', message: flavorVerdict.reason };
  }

  const ts = deps.now();
  const submission: ForgeSubmission = {
    id: `${ts}-${input.author}`,
    archetype: input.archetype,
    params: clampParams(input.archetype, input.params),
    title: input.title.trim().toUpperCase(),
    flavor: input.flavor.trim(),
    author: input.author,
    ts,
  };
  await deps.redis.zAdd(K.forgeQueue, { member: JSON.stringify(submission), score: ts });
  const position = await deps.redis.zCard(K.forgeQueue);
  return { ok: true, position };
}

export type ForgeApproveResult =
  | { ok: true; title: string; author: string }
  | { ok: false; message: string };

/** Mod menu action: approve the OLDEST pending submission (FIFO via ts score). */
export async function approveForge(deps: Deps): Promise<ForgeApproveResult> {
  const oldest = await deps.redis.zRange(K.forgeQueue, 0, 0, { by: 'rank' });
  const entry = oldest[0];
  if (!entry) return { ok: false, message: 'The forge queue is empty.' };

  await deps.redis.zRem(K.forgeQueue, [entry.member]);
  try {
    const parsed = JSON.parse(entry.member) as ForgeSubmission;
    await deps.redis.zAdd(K.forgeApproved, { member: entry.member, score: entry.score });
    return { ok: true, title: parsed.title, author: parsed.author };
  } catch {
    return { ok: false, message: 'Malformed forge entry discarded.' };
  }
}
