/**
 * Test environment: RedisStub + fake Reddit/Realtime + the REAL Hono routes
 * wired exactly like src/server/index.ts. Endpoint tests hit `env.app.request`
 * — the same handlers production runs.
 */

import { Hono } from 'hono';
import type { Ctx, Deps, SubmittedCommentLike } from '../../src/server/core/deps';
import { makeApi } from '../../src/server/routes/api';
import { makeCron } from '../../src/server/routes/cron';
import { makeMenu } from '../../src/server/routes/menu';
import { makeTriggers } from '../../src/server/routes/triggers';
import { DAY_MS } from '../../src/server/core/time';
import { RedisStub } from './redis-stub';

export const TEST_DAY = 20_000; // arbitrary fixed UTC epoch-day
export const TEST_NOW = TEST_DAY * DAY_MS + 12 * 3_600_000; // noon UTC

export class FakeReddit {
  username: string | null = 'judge_jasmine';
  posts: { id: string; title: string }[] = [];
  comments: { id: string; postId: string; text: string; stickied: boolean }[] = [];
  flairTemplates: { id: string; text: string }[] = [];
  flairSet: { username: string; flairTemplateId?: string; text?: string }[] = [];
  failComments = false;
  /** Make submitCustomPost throw — exercises createDayPost's defensive catch. */
  failPosts = false;
  /** Make getCurrentUsername throw — exercises safeUsername's defensive catch. */
  failUsername = false;
  /** Make createUserFlairTemplate throw — exercises ensureFlairTemplates' catch. */
  failFlairTemplates = false;
  /** Make setUserFlair throw for a specific username — exercises weeklyCeremony's per-crown catch. */
  failFlairFor: string | null = null;

  async getCurrentUsername(): Promise<string | undefined> {
    if (this.failUsername) throw new Error('reddit API down');
    return this.username ?? undefined;
  }

  async submitCustomPost(opts: { title: string }): Promise<{ id: string }> {
    if (this.failPosts) throw new Error('submitCustomPost API down');
    const id = `t3_fake${this.posts.length + 1}`;
    this.posts.push({ id, title: opts.title });
    return { id };
  }

  async submitComment(opts: { id: string; text: string }): Promise<SubmittedCommentLike> {
    if (this.failComments) throw new Error('comment API down');
    const id = `t1_fake${this.comments.length + 1}`;
    const record = { id, postId: opts.id, text: opts.text, stickied: false };
    this.comments.push(record);
    return {
      id,
      distinguish: async (makeSticky?: boolean) => {
        record.stickied = makeSticky === true;
      },
    };
  }

  async createUserFlairTemplate(opts: { text: string }): Promise<{ id: string }> {
    if (this.failFlairTemplates) throw new Error('flair template API down');
    const id = `tpl_${this.flairTemplates.length + 1}`;
    this.flairTemplates.push({ id, text: opts.text });
    return { id };
  }

  async setUserFlair(opts: {
    username: string;
    flairTemplateId?: string;
    text?: string;
  }): Promise<void> {
    if (this.failFlairFor === opts.username) throw new Error(`setUserFlair(${opts.username}) down`);
    const entry: { username: string; flairTemplateId?: string; text?: string } = {
      username: opts.username,
    };
    if (opts.flairTemplateId !== undefined) entry.flairTemplateId = opts.flairTemplateId;
    if (opts.text !== undefined) entry.text = opts.text;
    this.flairSet.push(entry);
  }
}

export class FakeRealtime {
  sent: { channel: string; msg: unknown }[] = [];
  /** Make send() throw — exercises the pot_ticker best-effort catch in /api/commit. */
  failSend = false;
  async send(channel: string, msg: unknown): Promise<void> {
    if (this.failSend) throw new Error('realtime API down');
    this.sent.push({ channel, msg: JSON.parse(JSON.stringify(msg)) });
  }
}

export type TestEnv = {
  redis: RedisStub;
  reddit: FakeReddit;
  realtime: FakeRealtime;
  deps: Deps;
  app: Hono;
  setNow(ms: number): void;
  now(): number;
  setUser(userId: string | null, username: string | null): void;
};

export function makeEnv(overrides?: { now?: number }): TestEnv {
  const redis = new RedisStub();
  const reddit = new FakeReddit();
  const realtime = new FakeRealtime();
  let nowMs = overrides?.now ?? TEST_NOW;
  let ctx: Ctx = { userId: 't2_judge', postId: 't3_fake1', subredditName: 'TheCommonsGame' };

  const deps: Deps = {
    redis,
    reddit,
    realtime,
    now: () => nowMs,
    ctx: () => ctx,
  };

  const app = new Hono();
  const internal = new Hono();
  internal.route('/cron', makeCron(deps));
  internal.route('/menu', makeMenu(deps));
  internal.route('/triggers', makeTriggers(deps));
  app.route('/api', makeApi(deps));
  app.route('/internal', internal);

  return {
    redis,
    reddit,
    realtime,
    deps,
    app,
    setNow: (ms) => {
      nowMs = ms;
    },
    now: () => nowMs,
    setUser: (userId, username) => {
      ctx = { ...ctx, userId: userId ?? undefined };
      reddit.username = username;
    },
  };
}

export const postJson = (
  app: Hono,
  path: string,
  body?: unknown
): Promise<Response> =>
  // Hono's `request` overload returns `Response | Promise<Response>`; normalize
  // to a Promise so this helper's signature is honest.
  Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  );
