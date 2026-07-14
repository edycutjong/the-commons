/**
 * Redis key map — exactly the ARCHITECTURE.md schema plus four as-built
 * support keys (pointer, index, display-pot counter, approved-forge set),
 * documented in the README schema table.
 */

export const K = {
  round: (day: number) => `round:${day}`,
  commit: (day: number) => `commit:${day}`,
  outcome: (day: number) => `outcome:${day}`,
  streak: (userId: string) => `streak:${userId}`,
  repSaint: 'rep:saint',
  repSerpent: 'rep:serpent',
  seasonPoints: 'season:points',
  forgeQueue: 'forge:queue',
  forgeApproved: 'forge:approved',
  /** Day number of the round currently pointed at by the game clock. */
  roundCurrent: 'round:current',
  /** zset day -> day, so history can enumerate rounds (Devvit Redis has no key scan). */
  roundIndex: 'round:index',
  /** Display-only pot ticker counter (authoritative pot is recomputed at settle). */
  pot: (day: number) => `pot:${day}`,
  /** Day of the most recently settled round. */
  settledLast: 'settled:last',
  /** postId -> day mapping so triggers can recognize our own day posts. */
  post: (postId: string) => `post:${postId}`,
  /** Cached flair template ids (JSON). */
  flairTemplates: 'flair:templates',
  /** Last ceremony result (JSON) for the in-app crown chips. */
  ceremonyLast: 'ceremony:last',
} as const;

export const OUTCOME_SUMMARY_FIELD = 'summary';
export const outcomeUserField = (userId: string): string => `u:${userId}`;
