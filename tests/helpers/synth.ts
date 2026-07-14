/**
 * Synthetic commit generation — shared by the property tests, race tests and
 * scripts/bench.mjs. Deterministic by construction.
 */

import type { EngineCommit } from '../../src/shared/payoffs';
import type { StoredCommit } from '../../src/server/core/commits';
import { K } from '../../src/server/core/keys';
import type { RedisLike } from '../../src/server/core/redis';

/** n commits split across `choices` by exact counts (must sum to n). */
export function commitsWithCounts(counts: Record<string, number>): EngineCommit[] {
  const out: EngineCommit[] = [];
  let i = 0;
  for (const [choice, count] of Object.entries(counts)) {
    for (let k = 0; k < count; k++, i++) {
      const id = String(i).padStart(5, '0');
      out.push({
        userId: `t2_syn_${id}`,
        username: `synthetic_${id}`,
        choice,
        stake: 10 + (i % 4) * 10,
      });
    }
  }
  return out;
}

/** Same proportions at a different population size. */
export function scaleCounts(
  counts: Record<string, number>,
  factor: number
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [choice, n] of Object.entries(counts)) out[choice] = n * factor;
  return out;
}

/** Load engine commits into the commit hash the way the seed does. */
export async function loadCommits(
  redis: RedisLike,
  day: number,
  commits: EngineCommit[],
  ts = 0
): Promise<void> {
  const CHUNK = 1000;
  let pot = 0;
  for (let i = 0; i < commits.length; i += CHUNK) {
    const fields: Record<string, string> = {};
    for (const c of commits.slice(i, i + CHUNK)) {
      const stored: StoredCommit = {
        choice: c.choice,
        stake: c.stake,
        insured: false,
        username: c.username,
        ts,
      };
      fields[c.userId] = JSON.stringify(stored);
      pot += c.stake;
    }
    await redis.hSet(K.commit(day), fields);
  }
  if (pot > 0) await redis.incrBy(K.pot(day), pot);
}
