/** Round lifecycle: open, read, pick the next dilemma, project the sealed public view. */

import type { Archetype, Params } from '../../shared/payoffs';
import { defaultParams, choicesFor, isArchetype } from '../../shared/payoffs';
import type { RoundView } from '../../shared/api';
import type { Deps } from './deps';
import { K } from './keys';
import { nextMidnightUtc } from './time';

export type RoundState = 'open' | 'settled' | 'void';

export type RoundRecord = {
  day: number;
  archetype: Archetype;
  params: Params;
  state: RoundState;
  title: string;
  flavor: string;
  author: string | null;
  postId: string | null;
  openedAt: number;
  settledAt: number | null;
  preseason: boolean;
};

export type OpenRoundInput = {
  day: number;
  archetype: Archetype;
  params: Params;
  title: string;
  flavor: string;
  author?: string | null;
  postId?: string | null;
  openedAt: number;
  preseason?: boolean;
};

export async function openRound(deps: Deps, input: OpenRoundInput): Promise<RoundRecord> {
  const record: RoundRecord = {
    day: input.day,
    archetype: input.archetype,
    params: input.params,
    state: 'open',
    title: input.title,
    flavor: input.flavor,
    author: input.author ?? null,
    postId: input.postId ?? null,
    openedAt: input.openedAt,
    settledAt: null,
    preseason: input.preseason ?? false,
  };
  await deps.redis.hSet(K.round(input.day), serializeRound(record));
  await deps.redis.zAdd(K.roundIndex, { member: String(input.day), score: input.day });
  await deps.redis.set(K.roundCurrent, String(input.day));
  return record;
}

export async function getRound(deps: Deps, day: number): Promise<RoundRecord | null> {
  const raw = await deps.redis.hGetAll(K.round(day));
  if (!raw || Object.keys(raw).length === 0) return null;
  return parseRound(raw);
}

export async function currentRound(deps: Deps): Promise<RoundRecord | null> {
  const pointer = await deps.redis.get(K.roundCurrent);
  if (!pointer) return null;
  const day = Number.parseInt(pointer, 10);
  if (Number.isNaN(day)) return null;
  return getRound(deps, day);
}

/** The sealed public projection: participation + pot only. Never the split. */
export async function publicRoundView(deps: Deps, round: RoundRecord): Promise<RoundView> {
  const [participants, potRaw] = await Promise.all([
    deps.redis.hLen(K.commit(round.day)),
    deps.redis.get(K.pot(round.day)),
  ]);
  return {
    state: round.state === 'settled' ? 'interlude' : round.state,
    day: round.day,
    title: round.title,
    flavor: round.flavor,
    archetype: round.archetype,
    params: round.params,
    choices: choicesFor(round.archetype),
    participants,
    pot: potRaw ? Number.parseInt(potRaw, 10) || 0 : 0,
    revealAt: nextMidnightUtc(deps.now()),
    preseason: round.preseason,
    author: round.author,
    postId: round.postId,
  };
}

// --- built-in nightly rotation ----------------------------------------------

type Dilemma = { archetype: Archetype; params: Params; title: string; flavor: string; author: string | null };

const ROTATION: { archetype: Archetype; title: string; flavor: string }[] = [
  {
    archetype: 'public_pot',
    title: 'THE BLACKOUT POT',
    flavor:
      'Feed the pot and pray. If enough of you feed, every stake multiplies. Hoarders take triple — unless the hoarding tips the line, and everything burns.',
  },
  {
    archetype: 'stag_hunt',
    title: 'THE LONG HUNT',
    flavor:
      'The stag feeds everyone — if enough hunters hold the line. The hare feeds one, always. Choose what you hunt.',
  },
  {
    archetype: 'chicken',
    title: 'THE NARROW BRIDGE',
    flavor:
      'Two lanes, one bridge. Swerve and bank small. Dare and take triple — unless too many dare, and the bridge takes you all.',
  },
  {
    archetype: 'lowest_unique',
    title: 'THE QUIET NUMBER',
    flavor:
      'Pick a number. The rarest low number takes the table. Whisper strategies in the comments — then bid alone.',
  },
  {
    archetype: 'exact_n',
    title: 'THE VAULT JOB',
    flavor:
      'The vault opens for a crew of an exact size. Too few and the door holds. Too many and the alarm sings. Guards collect either way — unless it opens.',
  },
];

/**
 * Pick tonight's dilemma: oldest approved Forge template first, otherwise
 * built-in rotation keyed by day number (deterministic).
 */
export async function nextDilemma(deps: Deps, day: number): Promise<Dilemma> {
  const approved = await deps.redis.zRange(K.forgeApproved, 0, 0, { by: 'rank' });
  const first = approved[0];
  if (first) {
    await deps.redis.zRem(K.forgeApproved, [first.member]);
    try {
      const parsed = JSON.parse(first.member) as {
        archetype?: string;
        params?: Params;
        title?: string;
        flavor?: string;
        author?: string;
      };
      if (parsed.archetype && isArchetype(parsed.archetype) && parsed.title && parsed.flavor) {
        return {
          archetype: parsed.archetype,
          params: parsed.params ?? defaultParams(parsed.archetype),
          title: parsed.title,
          flavor: parsed.flavor,
          author: parsed.author ?? null,
        };
      }
    } catch {
      // fall through to rotation on malformed queue entries
    }
  }
  const slot = ROTATION[((day % ROTATION.length) + ROTATION.length) % ROTATION.length];
  /* v8 ignore next -- ROTATION is a fixed non-empty array; the modulo index is always in [0, ROTATION.length), so slot is always defined for any integer day */
  if (!slot) throw new Error('rotation table empty');
  return {
    archetype: slot.archetype,
    params: defaultParams(slot.archetype),
    title: slot.title,
    flavor: slot.flavor,
    author: null,
  };
}

// --- (de)serialization --------------------------------------------------------

export function serializeRound(r: RoundRecord): Record<string, string> {
  return {
    day: String(r.day),
    archetype: r.archetype,
    params: JSON.stringify(r.params),
    state: r.state,
    title: r.title,
    flavor: r.flavor,
    author: r.author ?? '',
    postId: r.postId ?? '',
    openedAt: String(r.openedAt),
    settledAt: r.settledAt === null ? '' : String(r.settledAt),
    preseason: r.preseason ? '1' : '0',
  };
}

export function parseRound(raw: Record<string, string>): RoundRecord | null {
  const archetype = raw['archetype'] ?? '';
  if (!isArchetype(archetype)) return null;
  let params: Params;
  try {
    params = JSON.parse(raw['params'] ?? '{}') as Params;
  } catch {
    params = defaultParams(archetype);
  }
  const state = raw['state'];
  return {
    day: Number.parseInt(raw['day'] ?? '0', 10) || 0,
    archetype,
    params,
    state: state === 'settled' || state === 'void' ? state : 'open',
    title: raw['title'] ?? 'THE COMMONS',
    flavor: raw['flavor'] ?? '',
    author: raw['author'] ? raw['author'] : null,
    postId: raw['postId'] ? raw['postId'] : null,
    openedAt: Number.parseInt(raw['openedAt'] ?? '0', 10) || 0,
    settledAt: raw['settledAt'] ? Number.parseInt(raw['settledAt'], 10) : null,
    preseason: raw['preseason'] === '1',
  };
}
