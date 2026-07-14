/**
 * api.ts edge cases not already reached through endpoints.test.ts: no round
 * at all (GET /round + POST /commit), malformed request bodies, the
 * typeof-guard branches on choice/stake, the best-effort realtime-send
 * catch, safeUsername's own defensive catch, and the /history limit
 * parsing branches.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, postJson, type TestEnv } from './helpers/env';
import type { RoundResponse } from '../src/shared/api';

function rawPost(env: TestEnv, path: string, rawBody: string) {
  return env.app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
}

describe('GET /api/round — no round bound at all', () => {
  it('returns round: null when nothing has ever opened', async () => {
    const env = makeEnv();
    const res = await env.app.request('/api/round');
    const body = (await res.json()) as RoundResponse;
    expect(body.round).toBeNull();
    expect(body.me.loggedIn).toBe(true); // still resolves the viewer identity
  });
});

describe('POST /api/commit — malformed / missing-round input', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
    env.setUser('t2_judge', 'judge_jasmine');
  });

  it('rejects when no dilemma is open at all', async () => {
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('no_round');
  });

  it('rejects a request body that is not valid JSON', async () => {
    await postJson(env.app, '/internal/cron/open');
    const res = await rawPost(env, '/api/commit', '{not-json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('bad_request');
  });

  it('rejects a body with no choice field', async () => {
    await postJson(env.app, '/internal/cron/open');
    const res = await postJson(env.app, '/api/commit', { stake: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('bad_request');
  });

  it('treats a non-numeric stake as NaN, which sanitizes to bad_stake', async () => {
    await postJson(env.app, '/internal/cron/open');
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: '10' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('bad_stake');
  });

  it('still seals the commit when the realtime pot-ticker send fails', async () => {
    await postJson(env.app, '/internal/cron/open');
    env.realtime.failSend = true;
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('sealed');
    expect(env.realtime.sent).toHaveLength(0); // never recorded — send() threw
  });
});

describe('POST /api/forge — malformed request body', () => {
  it('rejects a request body that is not valid JSON', async () => {
    const env = makeEnv();
    env.setUser('t2_judge', 'judge_jasmine');
    const res = await rawPost(env, '/api/forge', '{not-json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('bad_request');
  });
});

describe('safeUsername — reddit API failure degrades to logged-out', () => {
  it('GET /api/round treats a throwing getCurrentUsername as anonymous', async () => {
    const env = makeEnv();
    env.reddit.failUsername = true;
    const res = await env.app.request('/api/round');
    const body = (await res.json()) as RoundResponse;
    expect(body.me.loggedIn).toBe(false);
  });

  it('POST /api/commit reports not_logged_in when username resolution throws', async () => {
    const env = makeEnv();
    env.reddit.failUsername = true;
    await postJson(env.app, '/internal/cron/open');
    const res = await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/history — limit parsing', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = makeEnv();
    await postJson(env.app, '/internal/cron/open');
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    await postJson(env.app, '/internal/cron/settle');
  });

  it('honors an explicit numeric ?limit=', async () => {
    const res = await env.app.request('/api/history?limit=1');
    expect(res.status).toBe(200);
  });

  it('falls back to 14 for a non-numeric ?limit=', async () => {
    const res = await env.app.request('/api/history?limit=abc');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(1);
  });

  it('defaults to 14 with no ?limit= at all', async () => {
    const res = await env.app.request('/api/history');
    expect(res.status).toBe(200);
  });

  it('serves history for a logged-out viewer (mine always null)', async () => {
    env.setUser(null, null);
    const res = await env.app.request('/api/history');
    const body = (await res.json()) as { entries: { mine: unknown }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.mine).toBeNull();
  });
});
