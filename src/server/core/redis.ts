/**
 * Structural interfaces for the slice of the Devvit Redis client we use.
 * `@devvit/web/server`'s RedisClient satisfies RedisLike; the in-memory test
 * stub implements exactly this surface (and nothing more), which keeps the
 * codebase honest about which commands it depends on.
 *
 * NOTE: no plain lists/sets anywhere — hashes + zsets only, per platform
 * guidance (Devvit Redis does not support them).
 */

export type ZMemberLike = { member: string; score: number };

export type ZRangeOptionsLike = {
  reverse?: boolean;
  by: 'score' | 'lex' | 'rank';
  limit?: { offset: number; count: number };
};

export type TxLike = {
  multi(): Promise<void>;
  exec(): Promise<unknown[] | null>;
  discard(): Promise<void>;
  unwatch(): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  hSet(key: string, fieldValues: { [field: string]: string }): Promise<unknown>;
  hSetNX(key: string, field: string, value: string): Promise<unknown>;
  zAdd(key: string, ...members: ZMemberLike[]): Promise<unknown>;
  zRem(key: string, members: string[]): Promise<unknown>;
};

export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<string>;
  del(...keys: string[]): Promise<void>;
  exists(...keys: string[]): Promise<number>;
  incrBy(key: string, value: number): Promise<number>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, fieldValues: { [field: string]: string }): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
  hLen(key: string): Promise<number>;
  hKeys(key: string): Promise<string[]>;
  zAdd(key: string, ...members: ZMemberLike[]): Promise<number>;
  zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptionsLike
  ): Promise<ZMemberLike[]>;
  zRem(key: string, members: string[]): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zCard(key: string): Promise<number>;
  watch(...keys: string[]): Promise<TxLike>;
};
