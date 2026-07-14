/**
 * Settle-latency bench — the real settle transaction against the in-memory
 * RedisStub, at 100 / 1,000 / 10,000 synthetic commits. Prints p50/p95/mean
 * per size and checks the PRD budget (10k settle < 2s).
 *
 * Runs on plain `node scripts/bench.mjs`: we register tsx's ESM loader so the
 * TypeScript engine + the shared test helpers (tests/helpers/synth.ts, which is
 * explicitly shared with this bench) import directly, no precompile step.
 */

import { performance } from 'node:perf_hooks';
import { register } from 'tsx/esm/api';

// Register tsx's ESM hooks so the TypeScript engine + shared test helpers
// import directly under plain `node`. (tsx's own register(), not node:module's.)
register();

const { makeEnv, TEST_DAY } = await import('../tests/helpers/env.ts');
const { commitsWithCounts, loadCommits } = await import('../tests/helpers/synth.ts');
const { openRound } = await import('../src/server/core/rounds.ts');
const { settleRound } = await import('../src/server/core/settle.ts');
const { DAY_MS } = await import('../src/server/core/time.ts');
const { defaultParams, resolve } = await import('../src/shared/payoffs/index.ts');

const SIZES = [100, 1000, 10000];
const runsFor = (n) => (n >= 10000 ? 15 : n >= 1000 ? 30 : 60);
const WARMUP = 3;

/** nearest-rank percentile over an unsorted sample */
function percentile(samples, q) {
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx];
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (ms) => `${ms.toFixed(2)}ms`.padStart(9);

async function settleOnce(n) {
  const feed = Math.round(n * 0.65);
  const hoard = n - feed;
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
  await loadCommits(env.redis, TEST_DAY, commitsWithCounts({ FEED: feed, HOARD: hoard }));

  const t0 = performance.now();
  const r = await settleRound(env.deps, TEST_DAY, { at: (TEST_DAY + 1) * DAY_MS });
  const dt = performance.now() - t0;
  if (r.status !== 'settled') throw new Error(`bench settle failed: ${r.status}`);
  if (r.summary.participants !== n) throw new Error(`bench count mismatch: ${r.summary.participants} != ${n}`);
  return dt;
}

async function main() {
  console.log('\nThe Commons — settle-latency bench (RedisStub, node ' + process.version + ')');
  console.log('commits    runs        p50        p95       mean   engine-only');
  console.log('-------  ------  ---------  ---------  ---------  -----------');

  let worst10k = 0;
  for (const n of SIZES) {
    const runs = runsFor(n);
    for (let i = 0; i < WARMUP; i++) await settleOnce(n);

    const samples = [];
    for (let i = 0; i < runs; i++) samples.push(await settleOnce(n));

    // pure-engine resolve time (no redis I/O) for context
    const feed = Math.round(n * 0.65);
    const commits = commitsWithCounts({ FEED: feed, HOARD: n - feed });
    const e0 = performance.now();
    resolve('public_pot', defaultParams('public_pot'), commits);
    const engineMs = performance.now() - e0;

    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    if (n === 10000) worst10k = p95;
    console.log(
      `${String(n).padStart(7)}  ${String(runs).padStart(6)}  ${fmt(p50)}  ${fmt(p95)}  ${fmt(mean(samples))}  ${fmt(engineMs)}`
    );
  }

  const budget = 2000;
  const ok = worst10k < budget;
  console.log(`\nPRD budget: 10k settle p95 ${worst10k.toFixed(2)}ms ${ok ? '<' : '>='} ${budget}ms  →  ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
