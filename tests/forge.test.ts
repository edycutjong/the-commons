/**
 * Dilemma Forge edge cases not already reached through endpoints.test.ts:
 * non-string title/flavor payloads, an empty approval queue, and a
 * malformed (non-JSON) queue entry surviving to approval.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from './helpers/env';
import { submitForge, approveForge } from '../src/server/core/forge';
import { K } from '../src/server/core/keys';

describe('submitForge — malformed input', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('rejects a non-string title', async () => {
    const result = await submitForge(env.deps, {
      author: 'judge_jasmine',
      archetype: 'chicken',
      params: {},
      title: 123,
      flavor: 'ok flavor text',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('bad_request');
  });

  it('rejects a hostile title even when the flavor text is clean', async () => {
    const result = await submitForge(env.deps, {
      author: 'judge_jasmine',
      archetype: 'chicken',
      params: {},
      title: 'kys everyone',
      flavor: 'a perfectly clean line of flavor text',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('filter_rejected');
  });

  it('rejects a non-string flavor', async () => {
    const result = await submitForge(env.deps, {
      author: 'judge_jasmine',
      archetype: 'chicken',
      params: {},
      title: 'a fine title',
      flavor: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('bad_request');
  });
});

describe('approveForge', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('reports a clean message when the queue is empty', async () => {
    const result = await approveForge(env.deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('empty');
  });

  it('discards a malformed (non-JSON) queue entry', async () => {
    await env.redis.zAdd(K.forgeQueue, { member: 'not-json-at-all', score: 1 });
    const result = await approveForge(env.deps);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('Malformed');
    // the bad entry is still removed from the queue (FIFO consumed regardless)
    expect(await env.redis.zCard(K.forgeQueue)).toBe(0);
    expect(await env.redis.zCard(K.forgeApproved)).toBe(0);
  });
});
