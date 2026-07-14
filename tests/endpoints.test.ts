/**
 * Endpoint tests against the REAL Hono handlers (factory-wired stubs).
 *
 * The sealed-shape tests are invariant I1 as executable spec: /api/round and
 * /api/history responses are asserted key-by-key, and the raw JSON is swept
 * for split-shaped leakage while sealed commits exist server-side.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, postJson, TEST_DAY, TEST_NOW, type TestEnv } from './helpers/env';
import { K } from '../src/server/core/keys';
import { commitsWithCounts, loadCommits } from './helpers/synth';
import type { RoundResponse, HistoryResponse, LaddersResponse } from '../src/shared/api';

const ROUND_KEYS = [
  'archetype',
  'author',
  'choices',
  'day',
  'flavor',
  'params',
  'participants',
  'postId',
  'preseason',
  'pot',
  'revealAt',
  'state',
  'title',
].sort();

const ME_KEYS = [
  'balance',
  'insuranceCost',
  'insuranceHeld',
  'loggedIn',
  'maxStake',
  'myCommit',
  'saintScore',
  'serpentScore',
  'streak',
  'username',
].sort();

const OUTCOME_KEYS = [
  'archetype',
  'author',
  'day',
  'detail',
  'flavor',
  'groupOutcome',
  'params',
  'participants',
  'pot',
  'preseason',
  'saints',
  'serpents',
  'settledAt',
  'split',
  'splitPct',
  'title',
  'verdict',
].sort();

async function openViaCron(env: TestEnv): Promise<void> {
  const res = await postJson(env.app, '/internal/cron/open');
  expect(res.status).toBe(200);
}

describe('sealed-shape protocol (invariant I1)', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = makeEnv();
    await openViaCron(env);
    // 40 sealed commits exist server-side while we probe the API
    await loadCommits(env.redis, TEST_DAY, commitsWithCounts({ FEED: 25, HOARD: 15 }));
  });

  it('/api/round returns exactly the allowed keys — nothing split-shaped', async () => {
    const res = await env.app.request('/api/round');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RoundResponse;
    expect(Object.keys(body).sort()).toEqual([
      'lastSettledDay',
      'me',
      'round',
      'serverNow',
      'type',
    ]);
    expect(body.round).not.toBeNull();
    expect(Object.keys(body.round!).sort()).toEqual(ROUND_KEYS);
    expect(Object.keys(body.me).sort()).toEqual(ME_KEYS);
    expect(body.round!.participants).toBe(40);
    expect(typeof body.round!.pot).toBe('number');
  });

  it('the raw pre-settle JSON never contains split-shaped keys, for any viewer', async () => {
    for (const viewer of ['in', 'out'] as const) {
      if (viewer === 'out') env.setUser(null, null);
      const res = await env.app.request('/api/round');
      const raw = await res.text();
      for (const forbidden of [
        '"split"',
        '"splitPct"',
        '"perUser"',
        '"verdict"',
        '"delta"',
        '"outcomeClass"',
        '"FEED":',
        '"HOARD":',
        '"saints"',
        '"serpents"',
      ]) {
        expect(raw, `viewer=${viewer} leaked ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('my own sealed commit is visible to me and only me', async () => {
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 10 });

    const mine = (await (await env.app.request('/api/round')).json()) as RoundResponse;
    expect(mine.me.myCommit).toEqual({ choice: 'FEED', stake: 10, insured: false });

    env.setUser('t2_other', 'other_olive');
    const other = (await (await env.app.request('/api/round')).json()) as RoundResponse;
    expect(other.me.myCommit).toBeNull();
    const raw = JSON.stringify(other);
    expect(raw).not.toContain('judge_jasmine');
  });

  it('/api/history is empty while the only round is still open', async () => {
    const res = await env.app.request('/api/history');
    const body = (await res.json()) as HistoryResponse;
    expect(body.entries).toEqual([]);
  });

  it('/api/history after settle exposes the split — and exactly the allowed keys', async () => {
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 10 });
    await postJson(env.app, '/internal/cron/settle');

    const body = (await (await env.app.request('/api/history')).json()) as HistoryResponse;
    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(['mine', 'outcome']);
    expect(Object.keys(entry.outcome).sort()).toEqual(OUTCOME_KEYS);
    expect(entry.outcome.split['FEED']).toBe(26);
    expect(entry.mine).not.toBeNull();
    expect(entry.mine!.choice).toBe('FEED');

    // Still no per-user dump: history is the public summary + ONLY my own row.
    // No other player's userId ever appears, and the crowd's sealed per-user
    // rows stay sealed. The curated top-3 "Saints/Serpents of the night" ARE
    // public by design — that IS the Reckoning (see settle.test.ts) — so a
    // couple of those usernames may surface, but a full roster never does.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('t2_syn_'); // no foreign userIds, ever
    expect(raw).not.toContain('synthetic_00024'); // an un-crowned feeder: no roster dump
    expect(raw).not.toContain('synthetic_00039'); // a hoarder earns nothing: never surfaced
  });
});

describe('/api/commit', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = makeEnv();
    await openViaCron(env);
    env.setUser('t2_judge', 'judge_jasmine');
  });

  it('seals a choice and broadcasts participation+pot only', async () => {
    const res = await postJson(env.app, '/api/commit', { choice: 'HOARD', stake: 25 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('sealed');
    expect(body['participants']).toBe(1);
    expect(body['pot']).toBe(25);

    expect(env.realtime.sent).toHaveLength(1);
    const sent = env.realtime.sent[0]!;
    expect(sent.channel).toBe('pot_ticker');
    expect(Object.keys(sent.msg as object).sort()).toEqual(['participants', 'pot']);
  });

  it('rejects a second commit from the same account (I2)', async () => {
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    const res = await postJson(env.app, '/api/commit', { choice: 'HOARD', stake: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('already_committed');
  });

  it('rejects commits after the settle (envelope sealed)', async () => {
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    await postJson(env.app, '/internal/cron/settle');
    env.setUser('t2_late', 'late_larry');
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('round_sealed');
  });

  it('rejects logged-out commits', async () => {
    env.setUser(null, null);
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    expect(res.status).toBe(401);
  });

  it('rejects choices outside tonight archetype', async () => {
    const res = await postJson(env.app, '/api/commit', { choice: 'STAG', stake: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('bad_choice');
  });

  it('clamps stakes to the table max and balance', async () => {
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 9999 });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['stake']).toBe(50); // maxStake with the default 100 balance
  });

  it('buys insurance atomically with the commit', async () => {
    const res = await postJson(env.app, '/api/commit', {
      choice: 'FEED',
      stake: 10,
      buyInsurance: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['insured']).toBe(true);
    expect(await env.redis.zScore(K.seasonPoints, 'judge_jasmine')).toBe(60); // 100 - 40
    const round = (await (await env.app.request('/api/round')).json()) as RoundResponse;
    expect(round.me.insuranceHeld).toBe(true);
    expect(round.me.balance).toBe(60);
  });

  it('rejects insurance the player cannot afford', async () => {
    await env.redis.zAdd(K.seasonPoints, { member: 'judge_jasmine', score: 20 });
    const res = await postJson(env.app, '/api/commit', {
      choice: 'FEED',
      stake: 0,
      buyInsurance: true,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('insufficient_points');
  });
});

describe('/api/forge', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = makeEnv();
    env.setUser('t2_judge', 'judge_jasmine');
  });

  it('queues a valid submission with clamped params', async () => {
    const res = await postJson(env.app, '/api/forge', {
      archetype: 'public_pot',
      params: { threshold: 0.95, feedMult: 99 },
      title: 'the midnight tax',
      flavor: 'Pay in or pray. The line is cruel tonight.',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('queued');
    expect(body['position']).toBe(1);

    const queued = await env.redis.zRange(K.forgeQueue, 0, 0, { by: 'rank' });
    const entry = JSON.parse(queued[0]!.member) as {
      params: Record<string, number>;
      title: string;
      author: string;
    };
    expect(entry.params['threshold']).toBe(0.9); // clamped to slider max
    expect(entry.params['feedMult']).toBe(3);
    expect(entry.title).toBe('THE MIDNIGHT TAX');
    expect(entry.author).toBe('judge_jasmine');
  });

  it('the wordlist filter rejects hostile flavor', async () => {
    const res = await postJson(env.app, '/api/forge', {
      archetype: 'chicken',
      params: {},
      title: 'fine title',
      flavor: 'everyone in this sub is a r3t4rd',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('filter_rejected');
  });

  it('rejects over-length flavor and unknown archetypes', async () => {
    const long = await postJson(env.app, '/api/forge', {
      archetype: 'chicken',
      params: {},
      title: 'ok',
      flavor: 'x'.repeat(141),
    });
    expect(long.status).toBe(400);

    const bad = await postJson(env.app, '/api/forge', {
      archetype: 'calvinball',
      params: {},
      title: 'ok',
      flavor: 'ok flavor',
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Record<string, unknown>)['code']).toBe('bad_request');
  });

  it('requires login', async () => {
    env.setUser(null, null);
    const res = await postJson(env.app, '/api/forge', {
      archetype: 'chicken',
      params: {},
      title: 'ok',
      flavor: 'ok flavor',
    });
    expect(res.status).toBe(401);
  });

  it('approve moves the oldest entry to the approved set; next open consumes it', async () => {
    await postJson(env.app, '/api/forge', {
      archetype: 'exact_n',
      params: { targetFrac: 0.1 },
      title: 'the tenth man',
      flavor: 'Ten percent walk out rich, or nobody does.',
    });
    const approve = await postJson(env.app, '/internal/menu/approve-forge');
    const toast = (await approve.json()) as { showToast?: string };
    expect(toast.showToast).toContain('THE TENTH MAN');
    expect(await env.redis.zCard(K.forgeQueue)).toBe(0);
    expect(await env.redis.zCard(K.forgeApproved)).toBe(1);

    await postJson(env.app, '/internal/cron/open');
    const round = (await (await env.app.request('/api/round')).json()) as RoundResponse;
    expect(round.round!.title).toBe('THE TENTH MAN');
    expect(round.round!.archetype).toBe('exact_n');
    expect(round.round!.author).toBe('judge_jasmine');
    expect(await env.redis.zCard(K.forgeApproved)).toBe(0); // consumed
  });
});

describe('cron + menu + trigger surfaces', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('open cron creates the day post and is idempotent', async () => {
    await openViaCron(env);
    expect(env.reddit.posts).toHaveLength(1);
    expect(env.reddit.posts[0]!.title).toContain('THE BLACKOUT POT');
    const again = await postJson(env.app, '/internal/cron/open');
    const body = (await again.json()) as Record<string, unknown>;
    expect(body['status']).toBe('noop');
    expect(env.reddit.posts).toHaveLength(1);
  });

  it('settle cron with no pointer is a safe noop', async () => {
    const res = await postJson(env.app, '/internal/cron/settle');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('noop');
  });

  it('settle cron posts a stickied Reckoning comment on the day post', async () => {
    await openViaCron(env);
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 10 });
    const res = await postJson(env.app, '/internal/cron/settle');
    expect(((await res.json()) as Record<string, unknown>)['status']).toBe('settled');
    expect(env.reddit.comments).toHaveLength(1);
    const comment = env.reddit.comments[0]!;
    expect(comment.text).toContain('THE RECKONING');
    expect(comment.stickied).toBe(true);
  });

  it('a failed Reckoning comment never un-settles the round', async () => {
    await openViaCron(env);
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 10 });
    env.reddit.failComments = true;
    const res = await postJson(env.app, '/internal/cron/settle');
    expect(((await res.json()) as Record<string, unknown>)['status']).toBe('settled');
    expect(await env.redis.hGet(K.round(TEST_DAY), 'state')).toBe('settled');
  });

  it('void round menu action seals the night forever', async () => {
    await openViaCron(env);
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 10 });
    const voided = await postJson(env.app, '/internal/menu/void-round');
    expect(((await voided.json()) as { showToast?: string }).showToast).toContain('voided');

    const settle = await postJson(env.app, '/internal/cron/settle');
    expect(((await settle.json()) as Record<string, unknown>)['status']).toBe('void');

    const history = (await (await env.app.request('/api/history')).json()) as HistoryResponse;
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]!.outcome.groupOutcome).toBe('void');
    expect(JSON.stringify(history.entries[0]!)).not.toContain('FEED');
  });

  it('force settle equals the cron settle (menu path)', async () => {
    await openViaCron(env);
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'HOARD', stake: 10 });
    const res = await postJson(env.app, '/internal/menu/force-settle');
    expect(((await res.json()) as { showToast?: string }).showToast).toContain('settled');
    expect(await env.redis.hGet(K.round(TEST_DAY), 'state')).toBe('settled');
  });

  it('post-create trigger answers success for foreign and own posts', async () => {
    const foreign = await postJson(env.app, '/internal/triggers/post-create', {
      post: { id: 't3_foreign' },
    });
    expect(((await foreign.json()) as Record<string, unknown>)['status']).toBe('success');
    await openViaCron(env);
    const own = await postJson(env.app, '/internal/triggers/post-create', {
      post: { id: env.reddit.posts[0]!.id },
    });
    expect(((await own.json()) as Record<string, unknown>)['status']).toBe('success');
  });

  it('/api/ladders serves ranked rows with the decay constant', async () => {
    await env.redis.zAdd(
      K.repSaint,
      { member: 'ash', score: 55 },
      { member: 'birch', score: 40 }
    );
    await env.redis.zAdd(K.repSerpent, { member: 'laurel', score: 25 });
    const res = await env.app.request('/api/ladders');
    const body = (await res.json()) as LaddersResponse;
    expect(body.saint[0]).toEqual({ username: 'ash', score: 55, rank: 1 });
    expect(body.saint[1]!.rank).toBe(2);
    expect(body.serpent[0]!.username).toBe('laurel');
    expect(body.weeklyDecay).toBe(0.8);
  });

  it('round view survives the interlude (settled, before next open)', async () => {
    await openViaCron(env);
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 10 });
    await postJson(env.app, '/internal/cron/settle');
    const body = (await (await env.app.request('/api/round')).json()) as RoundResponse;
    expect(body.round!.state).toBe('interlude');
    expect(body.lastSettledDay).toBe(TEST_DAY);
    // sealed rules still hold on the interlude projection
    expect(JSON.stringify(body.round)).not.toContain('"split"');
    expect(body.serverNow).toBe(TEST_NOW);
  });
});
