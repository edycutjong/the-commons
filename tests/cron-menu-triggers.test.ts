/**
 * cron/menu/triggers edge cases not already reached through
 * endpoints.test.ts: a corrupted round-pointer, void-round with no current
 * round / a non-open round, force-settle's noop and failure paths,
 * seed-preseason's failure path, and the post-create trigger's defensive
 * catch.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, postJson, TEST_DAY, type TestEnv } from './helpers/env';
import { K } from '../src/server/core/keys';

describe('cron/settle — corrupted pointer', () => {
  it('is a safe noop when round:current is not a number', async () => {
    const env = makeEnv();
    await env.redis.set(K.roundCurrent, 'not-a-number');
    const res = await postJson(env.app, '/internal/cron/settle');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['status']).toBe('noop');
  });
});

describe('menu/void-round', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('reports cleanly when there is no current round to void', async () => {
    const res = await postJson(env.app, '/internal/menu/void-round');
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('No current round');
  });

  it('reports cleanly when the current round is not open (already settled)', async () => {
    await postJson(env.app, '/internal/cron/open');
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    await postJson(env.app, '/internal/cron/settle');
    const res = await postJson(env.app, '/internal/menu/void-round');
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('is not open');
  });

  it('labels the state as "none" when the round hash has no state field at all', async () => {
    await env.redis.set(K.roundCurrent, String(TEST_DAY));
    await env.redis.hSet(K.round(TEST_DAY), { day: String(TEST_DAY) }); // no 'state' field
    const res = await postJson(env.app, '/internal/menu/void-round');
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('state: none');
  });
});

describe('menu/force-settle — non-settled + failure paths', () => {
  it('reports the raw status when there is nothing to settle', async () => {
    const env = makeEnv();
    const res = await postJson(env.app, '/internal/menu/force-settle');
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('noop');
  });

  it('reports the raw status (with day) for an already-settled round', async () => {
    const env = makeEnv();
    await postJson(env.app, '/internal/cron/open');
    env.setUser('t2_judge', 'judge_jasmine');
    await postJson(env.app, '/api/commit', { choice: 'FEED', stake: 5 });
    await postJson(env.app, '/internal/cron/settle'); // settles it for real
    const res = await postJson(env.app, '/internal/menu/force-settle'); // re-run: already
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toBe(`Settle pass: already (day ${TEST_DAY}).`);
  });

  it('reports a clean failure toast when settle throws (conflict storm)', async () => {
    const env = makeEnv();
    await postJson(env.app, '/internal/cron/open');
    env.redis.pause = async () => {
      await env.redis.hSet(K.round(TEST_DAY), { jitter: String(Math.random()) });
    };
    const res = await postJson(env.app, '/internal/menu/force-settle');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('Settle failed');
  });
});

describe('menu/seed-preseason — failure path', () => {
  it('reports a clean failure toast when seeding throws', async () => {
    const env = makeEnv();
    const originalZAdd = env.redis.zAdd.bind(env.redis);
    let calls = 0;
    env.redis.zAdd = (async (...args: Parameters<typeof originalZAdd>) => {
      calls++;
      if (calls === 1) throw new Error('redis down mid-seed');
      return originalZAdd(...args);
    }) as typeof env.redis.zAdd;

    const res = await postJson(env.app, '/internal/menu/seed-preseason');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('Seeding failed');
  });
});

describe('menu/approve-forge — empty queue via the route', () => {
  it('surfaces the clean "queue is empty" message as the toast', async () => {
    const env = makeEnv();
    const res = await postJson(env.app, '/internal/menu/approve-forge');
    const body = (await res.json()) as { showToast?: string };
    expect(body.showToast).toContain('empty');
  });
});

describe('triggers/post-create — defensive catch', () => {
  it('answers error (not a throw) when redis.get fails mid-lookup', async () => {
    const env = makeEnv();
    env.redis.get = (async () => {
      throw new Error('redis down');
    }) as typeof env.redis.get;

    const res = await postJson(env.app, '/internal/triggers/post-create', {
      post: { id: 't3_whatever' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { status?: string; message?: string };
    expect(body.status).toBe('error');
  });
});
