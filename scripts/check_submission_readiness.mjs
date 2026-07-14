/**
 * Submission-readiness gate for The Commons.
 *
 * Static checks (fast): required files, devvit.json config, package scripts,
 * and the hard compliance rules —
 *   · no plain Redis lists/sets (sorted-sets + hashes only)
 *   · zero runtime AI (no LLM SDK imports anywhere)
 *   · ballots in-app only (never Reddit up/down-votes)
 *   · empty fetch allowlist (no external http in devvit.json or src)
 *
 * Subprocess checks (skip with --fast): `tsc --noEmit`, `vitest run`, `vite build`.
 *
 * Exits non-zero if anything fails. Usage: node scripts/check_submission_readiness.mjs [--fast]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAST = process.argv.includes('--fast');
const results = [];
const record = (label, ok, detail = '') => results.push({ label, ok, detail });

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const srcFiles = walk(join(ROOT, 'src'), ['.ts', '.tsx']);
const readSrc = () => srcFiles.map((f) => ({ f, t: readFileSync(f, 'utf8') }));

// --- 1. required deliverables ------------------------------------------------
for (const rel of [
  'devvit.json',
  'package.json',
  'src/server/index.ts',
  'src/client/game.html',
  'src/client/splash.html',
  'data/fixtures/preseason.json',
  'scripts/bench.mjs',
  'scripts/check_submission_readiness.mjs',
  'README.md',
  'DEMO.md',
  'docs/friction-log.md',
]) {
  record(`file: ${rel}`, existsSync(join(ROOT, rel)));
}

// --- 2. package.json scripts -------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const s of ['build', 'type-check', 'test', 'bench', 'check']) {
  record(`npm script: ${s}`, Boolean(pkg.scripts?.[s]));
}

// --- 3. devvit.json config ---------------------------------------------------
const devvit = JSON.parse(readFileSync(join(ROOT, 'devvit.json'), 'utf8'));
record('devvit: redis permission', devvit.permissions?.redis === true);
record('devvit: realtime permission', devvit.permissions?.realtime === true);
record('devvit: reddit permission', devvit.permissions?.reddit?.enable === true);
record('devvit: client entrypoints (splash+game)', Boolean(devvit.post?.entrypoints?.default && devvit.post?.entrypoints?.game));
record('devvit: settle + open + ceremony crons', Boolean(devvit.scheduler?.tasks?.settle && devvit.scheduler?.tasks?.['open-round'] && devvit.scheduler?.tasks?.['weekly-ceremony']));
record('devvit: onPostCreate trigger', Boolean(devvit.triggers?.onPostCreate));
record('devvit: EMPTY fetch allowlist (no external http)', !devvit.http && !devvit.permissions?.http && !devvit.fetch);

// --- 4. compliance greps over src/ ------------------------------------------
const src = readSrc();
const hits = (re) => src.filter(({ t }) => re.test(t)).map(({ f }) => relative(ROOT, f));

const listSetOps = hits(/\.(lPush|rPush|lRange|lPop|rPop|lInsert|lLen|sAdd|sRem|sMembers|sIsMember|sCard|sPop|sInter|sUnion)\s*\(/);
record('no plain redis lists/sets', listSetOps.length === 0, listSetOps.join(', '));

const aiHits = hits(/\b(openai|anthropic|langchain|generativeai|cohere|mistralai|ollama|replicate|huggingface|@ai-sdk|vertexai)\b/i);
record('zero runtime AI (no LLM SDK)', aiHits.length === 0, aiHits.join(', '));

const voteHits = hits(/\.(upvote|downvote|submitVote)\s*\(/);
record('ballots in-app only (no reddit votes)', voteHits.length === 0, voteHits.join(', '));

const extFetch = hits(/fetch\s*\(\s*[`'"]https?:\/\//i);
record('no external fetch in src (same-origin only)', extFetch.length === 0, extFetch.join(', '));

// verified reddit surface only (no invented client methods)
const REDDIT_OK = new Set(['getCurrentUsername', 'submitCustomPost', 'submitComment', 'createUserFlairTemplate', 'setUserFlair', 'distinguish']);
const redditCalls = new Set();
for (const { t } of src) for (const m of t.matchAll(/\breddit\.(\w+)\s*\(|deps\.reddit\.(\w+)\s*\(/g)) {
  const name = m[1] ?? m[2];
  if (name && !REDDIT_OK.has(name)) redditCalls.add(name);
}
record('verified reddit API surface only', redditCalls.size === 0, [...redditCalls].join(', '));

// --- 5. subprocess gates (skip with --fast) ----------------------------------
function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return { label, r };
}
if (!FAST) {
  const tc = run('type-check (tsc --noEmit)', 'npx', ['tsc', '--noEmit']);
  record(tc.label, tc.r.status === 0, tc.r.status === 0 ? '' : (tc.r.stdout || tc.r.stderr || '').split('\n').slice(0, 3).join(' '));

  const tv = run('tests (vitest run)', 'npx', ['vitest', 'run']);
  const out = (tv.r.stdout || '') + (tv.r.stderr || '');
  const m = out.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
  const passed = m ? Number(m[1]) : 0;
  const total = m ? Number(m[2]) : 0;
  record('tests (vitest run)', tv.r.status === 0 && passed === total && total > 0, `${passed}/${total} passed`);

  const tb = run('build (vite build)', 'npm', ['run', 'build']);
  const distOk = existsSync(join(ROOT, 'dist/server/index.cjs')) && existsSync(join(ROOT, 'dist/client/game.html')) && existsSync(join(ROOT, 'dist/client/splash.html'));
  record('build (vite build)', tb.r.status === 0 && distOk, distOk ? '' : 'missing dist outputs');
} else {
  record('subprocess gates (tsc/test/build)', true, 'skipped (--fast)');
}

// --- report ------------------------------------------------------------------
console.log('\nThe Commons — submission readiness\n');
let failed = 0;
for (const { label, ok, detail } of results) {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.` + (failed ? `  ${failed} FAILED.` : '  READY.'));
process.exit(failed ? 1 : 0);
