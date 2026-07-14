/**
 * Devvit server entry — wires the real runtime clients into the Deps
 * container and mounts the route factories. This is the ONLY file that
 * touches @devvit/web/server; everything below it is testable in isolation.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import {
  context,
  createServer,
  getServerPort,
  realtime,
  reddit,
  redis,
} from '@devvit/web/server';

import type { Deps, RedditLike } from './core/deps';
import type { RedisLike } from './core/redis';
import { makeApi } from './routes/api';
import { makeCron } from './routes/cron';
import { makeMenu } from './routes/menu';
import { makeTriggers } from './routes/triggers';

const deps: Deps = {
  redis: redis as unknown as RedisLike,
  // RedditLike is a deliberately loosened, testable mirror of the real client
  // (e.g. `submitComment`'s id is `string` here vs the SDK's `t1_/t3_` template
  // literal). Bridge the two at this single Devvit boundary, like `redis` above.
  reddit: reddit as unknown as RedditLike,
  realtime,
  now: () => Date.now(),
  ctx: () => ({
    userId: context.userId,
    postId: context.postId,
    subredditName: context.subredditName,
  }),
};

const app = new Hono();
const internal = new Hono();

internal.route('/cron', makeCron(deps));
internal.route('/menu', makeMenu(deps));
internal.route('/triggers', makeTriggers(deps));

app.route('/api', makeApi(deps));
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
