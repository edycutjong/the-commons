/**
 * onPostCreate trigger. Fires for every post in the subreddit; we only care
 * about our own day posts (recognized via the post:{id} -> day mapping the
 * open cron writes). Deliberately conservative: never throws, never blocks.
 */

import { Hono } from 'hono';
import type { Deps } from '../core/deps';
import { K } from '../core/keys';

type TriggerResponse = { status: 'success' | 'error'; message?: string };

export function makeTriggers(deps: Deps): Hono {
  const triggers = new Hono();

  triggers.post('/post-create', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        post?: { id?: string };
      };
      const postId = body.post?.id;
      if (postId) {
        const day = await deps.redis.get(K.post(postId));
        if (day) {
          console.log(`day post recognized: ${postId} -> day ${day}`);
        }
      }
      return c.json<TriggerResponse>({ status: 'success' });
    } catch (e) {
      console.error('post-create trigger error:', e);
      return c.json<TriggerResponse>({ status: 'error', message: String(e) }, 400);
    }
  });

  return triggers;
}
