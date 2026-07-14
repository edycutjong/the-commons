/** createDayPost: happy path is already covered via the open cron in
 * endpoints.test.ts; this covers the defensive catch when the Reddit post
 * API itself fails (a missing post must never block the round). */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, type TestEnv } from './helpers/env';
import { createDayPost } from '../src/server/core/post';
import { K } from '../src/server/core/keys';

describe('createDayPost', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = makeEnv();
  });

  it('returns null and never throws when submitCustomPost fails', async () => {
    env.reddit.failPosts = true;
    const postId = await createDayPost(env.deps, { title: 'THE BLACKOUT POT', day: 20_000 });
    expect(postId).toBeNull();
    expect(await env.redis.get(K.post('anything'))).toBeUndefined();
  });
});
