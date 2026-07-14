/**
 * Weekly flair ceremony (Monday 01:00 UTC cron): the #1 Saint, #1 Serpent
 * and a seeded Wildcard wear subreddit flair for the week, then both ladders
 * decay ×0.8 so titles circulate.
 *
 * setUserFlair/createUserFlairTemplate verified in @devvit/reddit@0.13.6
 * .d.ts (docs-cache/VERIFIED.md) — flair-as-consequence ships as designed.
 * Synthetic preseason actors (commons_founder_*) are never flaired.
 */

import type { Deps } from './deps';
import { K } from './keys';
import { weekOf, dayOf } from './time';
import { ECONOMY, decayScore, seededPick } from '../../shared/payoffs';

type FlairTemplates = { saint: string; serpent: string; wildcard: string };

export type CeremonyResult = {
  week: number;
  saint: string | null;
  serpent: string | null;
  wildcard: string | null;
  decayed: { saint: number; serpent: number };
  flairErrors: string[];
};

const isSynthetic = (username: string): boolean => username.startsWith('commons_founder_');

export async function weeklyCeremony(deps: Deps): Promise<CeremonyResult> {
  const subredditName = deps.ctx().subredditName ?? '';
  const week = weekOf(dayOf(deps.now()));
  const flairErrors: string[] = [];

  const [saintTop, serpentTop, seasonTop] = await Promise.all([
    deps.redis.zRange(K.repSaint, 0, 4, { by: 'rank', reverse: true }),
    deps.redis.zRange(K.repSerpent, 0, 4, { by: 'rank', reverse: true }),
    deps.redis.zRange(K.seasonPoints, 0, 49, { by: 'rank', reverse: true }),
  ]);

  const saint = saintTop.find((m) => m.score > 0)?.member ?? null;
  const serpent = serpentTop.find((m) => m.score > 0 && m.member !== saint)?.member ?? null;
  const wildcardPool = seasonTop
    .map((m) => m.member)
    .filter((name) => name !== saint && name !== serpent);
  const wildcard = seededPick(`wildcard-week-${week}`, wildcardPool) ?? null;

  // Flair the crowned (skip synthetic founders; tolerate flair API failures —
  // the in-app crown chips render regardless).
  const templates = await ensureFlairTemplates(deps, subredditName, flairErrors);
  const crowns: [string | null, keyof FlairTemplates][] = [
    [saint, 'saint'],
    [serpent, 'serpent'],
    [wildcard, 'wildcard'],
  ];
  for (const [username, kind] of crowns) {
    if (!username || isSynthetic(username) || !subredditName) continue;
    try {
      await deps.reddit.setUserFlair({
        subredditName,
        username,
        ...(templates ? { flairTemplateId: templates[kind] } : flairFallback(kind)),
      });
    } catch (err) {
      flairErrors.push(`${kind}:${username}: ${String(err)}`);
    }
  }

  // Weekly decay ×0.8 (floor), dropping zeroed members.
  const decayed = {
    saint: await decayLadder(deps, K.repSaint),
    serpent: await decayLadder(deps, K.repSerpent),
  };

  await deps.redis.set(
    K.ceremonyLast,
    JSON.stringify({ week, saint, serpent, wildcard, at: deps.now() })
  );

  return { week, saint, serpent, wildcard, decayed, flairErrors };
}

async function decayLadder(deps: Deps, key: string): Promise<number> {
  const all = await deps.redis.zRange(key, 0, -1, { by: 'rank' });
  if (all.length === 0) return 0;
  const survivors: { member: string; score: number }[] = [];
  const dropped: string[] = [];
  for (const { member, score } of all) {
    const next = decayScore(score, ECONOMY.weeklyDecay);
    if (next > 0) survivors.push({ member, score: next });
    else dropped.push(member);
  }
  for (let i = 0; i < survivors.length; i += 500) {
    const chunk = survivors.slice(i, i + 500);
    if (chunk.length > 0) await deps.redis.zAdd(key, ...chunk);
  }
  for (let i = 0; i < dropped.length; i += 500) {
    const chunk = dropped.slice(i, i + 500);
    if (chunk.length > 0) await deps.redis.zRem(key, chunk);
  }
  return all.length;
}

async function ensureFlairTemplates(
  deps: Deps,
  subredditName: string,
  errors: string[]
): Promise<FlairTemplates | null> {
  if (!subredditName) return null;
  const cached = await deps.redis.get(K.flairTemplates);
  if (cached) {
    try {
      return JSON.parse(cached) as FlairTemplates;
    } catch {
      // fall through and recreate
    }
  }
  try {
    const [saint, serpent, wildcard] = await Promise.all([
      deps.reddit.createUserFlairTemplate({
        subredditName,
        text: '👼 Saint of the Commons',
        backgroundColor: '#8B5CF6',
        textColor: 'light',
        modOnly: true,
      }),
      deps.reddit.createUserFlairTemplate({
        subredditName,
        text: '🐍 Serpent of the Commons',
        backgroundColor: '#10B981',
        textColor: 'dark',
        modOnly: true,
      }),
      deps.reddit.createUserFlairTemplate({
        subredditName,
        text: '🃏 Wildcard of the Commons',
        backgroundColor: 'transparent',
        textColor: 'light',
        modOnly: true,
      }),
    ]);
    const templates: FlairTemplates = {
      saint: saint.id,
      serpent: serpent.id,
      wildcard: wildcard.id,
    };
    await deps.redis.set(K.flairTemplates, JSON.stringify(templates));
    return templates;
  } catch (err) {
    errors.push(`templates: ${String(err)}`);
    return null;
  }
}

function flairFallback(kind: keyof FlairTemplates): { text: string } {
  return {
    text:
      kind === 'saint'
        ? '👼 Saint of the Commons'
        : kind === 'serpent'
          ? '🐍 Serpent of the Commons'
          : '🃏 Wildcard of the Commons',
  };
}
