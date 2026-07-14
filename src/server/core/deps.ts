/**
 * Dependency container. Every route module is a factory over `Deps`, so the
 * whole server runs identically against the real Devvit runtime and against
 * the vitest in-memory stubs — the endpoint tests exercise the real Hono
 * handlers, not mocks of them.
 */

import type { RedisLike } from './redis';

export type Ctx = {
  userId?: string | undefined;
  postId?: string | undefined;
  subredditName?: string | undefined;
};

export type SubmittedPostLike = { id: string };

export type SubmittedCommentLike = {
  id: string;
  distinguish(makeSticky?: boolean): Promise<void>;
};

export type FlairTemplateLike = { id: string };

export type RedditLike = {
  getCurrentUsername(): Promise<string | undefined>;
  submitCustomPost(opts: {
    title: string;
    entry?: string;
    subredditName?: string;
  }): Promise<SubmittedPostLike>;
  submitComment(opts: { id: string; text: string }): Promise<SubmittedCommentLike>;
  createUserFlairTemplate(opts: {
    subredditName: string;
    text: string;
    backgroundColor?: string;
    textColor?: 'light' | 'dark';
    modOnly?: boolean;
  }): Promise<FlairTemplateLike>;
  setUserFlair(opts: {
    subredditName: string;
    username: string;
    flairTemplateId?: string;
    text?: string;
    backgroundColor?: string;
    textColor?: 'light' | 'dark';
  }): Promise<void>;
};

export type RealtimeLike = {
  send(channel: string, msg: unknown): Promise<void>;
};

export type Deps = {
  redis: RedisLike;
  reddit: RedditLike;
  realtime: RealtimeLike;
  /** Clock indirection — settle/seed determinism and tests hang off this. */
  now(): number;
  /** Request-scoped Devvit context (userId, postId, subredditName). */
  ctx(): Ctx;
};
