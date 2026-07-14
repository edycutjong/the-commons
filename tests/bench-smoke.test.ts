/**
 * Perf smoke: PRD demands settle <2s at 10k commits (against the stub).
 * scripts/bench.mjs prints the full 100/1k/10k p50/p95 table.
 */

import { describe, expect, it } from 'vitest';
import { makeEnv, TEST_DAY } from './helpers/env';
import { commitsWithCounts, loadCommits } from './helpers/synth';
import { openRound } from '../src/server/core/rounds';
import { settleRound } from '../src/server/core/settle';
import { DAY_MS } from '../src/server/core/time';
import { defaultParams, resolve } from '../src/shared/payoffs';

describe('settle latency smoke', () => {
  it('resolves 10k commits in the pure engine well under budget', () => {
    const commits = commitsWithCounts({ FEED: 6500, HOARD: 3500 });
    const t0 = performance.now();
    const r = resolve('public_pot', defaultParams('public_pot'), commits);
    const ms = performance.now() - t0;
    expect(r.outcome.participants).toBe(10_000);
    expect(ms).toBeLessThan(500);
  });

  it('full settle pass at 10k synthetic commits stays under 2s', async () => {
    const env = makeEnv();
    await openRound(env.deps, {
      day: TEST_DAY,
      archetype: 'public_pot',
      params: defaultParams('public_pot'),
      title: 'BENCH',
      flavor: 'bench',
      openedAt: TEST_DAY * DAY_MS,
      preseason: false,
    });
    await loadCommits(env.redis, TEST_DAY, commitsWithCounts({ FEED: 6500, HOARD: 3500 }));

    const t0 = performance.now();
    const result = await settleRound(env.deps, TEST_DAY, { at: (TEST_DAY + 1) * DAY_MS });
    const ms = performance.now() - t0;

    expect(result.status).toBe('settled');
    if (result.status !== 'settled') throw new Error('unreachable');
    expect(result.summary.participants).toBe(10_000);
    expect(ms).toBeLessThan(2000);
  });
});
