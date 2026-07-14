/**
 * Local seed dry-run: runs the real Seed Preseason pass against the in-memory
 * RedisStub and prints the six Reckonings, tonight's live round, and the top of
 * the Saint/Serpent ladders. No Devvit runtime needed — handy for inspecting the
 * exact deterministic demo state before `devvit playtest`.
 *
 * Usage: node scripts/seed-local.mjs
 */

import { register } from 'tsx/esm/api';
register();

const { makeEnv, TEST_DAY } = await import('../tests/helpers/env.ts');
const { seedPreseason } = await import('../src/server/core/seed.ts');
const { K } = await import('../src/server/core/keys.ts');

const env = makeEnv();
const result = await seedPreseason(env.deps, TEST_DAY);

const history = await (await env.app.request('/api/history?limit=6')).json();
const round = await (await env.app.request('/api/round')).json();

console.log(`\nSeed Preseason — ${result.seededRounds} rounds settled, tonight opened (day ${result.tonightDay}).\n`);
console.log('THE SIX RECKONINGS (newest first):');
for (const e of history.entries) {
  const o = e.outcome;
  console.log(`  ${o.title}`);
  console.log(`     ${o.verdict}  [${o.participants} souls · pot ${o.pot}]`);
  if (o.saints.length) console.log(`     Saints: ${o.saints.map((s) => 'u/' + s).join(', ')}`);
  if (o.serpents.length) console.log(`     Serpents: ${o.serpents.map((s) => 'u/' + s).join(', ')}`);
}

console.log(`\nTONIGHT (live): ${round.round.title} — ${round.round.state}, ${round.round.participants} souls, pot ${round.round.pot}`);

const saint = await env.redis.zRange(K.repSaint, 0, 2, { by: 'rank', reverse: true });
const serpent = await env.redis.zRange(K.repSerpent, 0, 2, { by: 'rank', reverse: true });
console.log('\nLADDERS:');
console.log(`  Saints:   ${saint.map((m) => `${m.member}(${m.score})`).join('  ')}`);
console.log(`  Serpents: ${serpent.map((m) => `${m.member}(${m.score})`).join('  ')}`);
console.log(`  Souls banked: ${await env.redis.zCard(K.seasonPoints)}\n`);
