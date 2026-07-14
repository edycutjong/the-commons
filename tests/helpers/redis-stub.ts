/**
 * In-memory Redis stub implementing EXACTLY the RedisLike surface the server
 * uses — including optimistic-lock WATCH/MULTI/EXEC semantics faithful to
 * the documented Devvit behavior:
 *
 *  - watch(keys) snapshots per-key versions;
 *  - queued commands apply atomically at exec();
 *  - exec() returns null (applying NOTHING) when any watched key was
 *    modified after the watch — this is what the race tests lean on;
 *  - hSetNX inside a transaction reports 1/0 like real Redis.
 *
 * A `pause()` hook lets tests deterministically interleave a competing write
 * between WATCH and EXEC to reproduce the commit-vs-settle race.
 */

import type { RedisLike, TxLike, ZMemberLike, ZRangeOptionsLike } from '../../src/server/core/redis';

type Store = {
  strings: Map<string, string>;
  hashes: Map<string, Map<string, string>>;
  zsets: Map<string, Map<string, number>>;
  versions: Map<string, number>;
};

type QueuedOp = () => unknown;

export class RedisStub implements RedisLike {
  private store: Store = {
    strings: new Map(),
    hashes: new Map(),
    zsets: new Map(),
    versions: new Map(),
  };

  /** Total commands executed (rough) — handy for bench sanity. */
  commandCount = 0;

  private bump(key: string): void {
    this.store.versions.set(key, (this.store.versions.get(key) ?? 0) + 1);
  }

  private version(key: string): number {
    return this.store.versions.get(key) ?? 0;
  }

  // --- strings ---------------------------------------------------------------

  async get(key: string): Promise<string | undefined> {
    this.commandCount++;
    return this.store.strings.get(key);
  }

  async set(key: string, value: string): Promise<string> {
    this.commandCount++;
    this.store.strings.set(key, value);
    this.bump(key);
    return 'OK';
  }

  async del(...keys: string[]): Promise<void> {
    this.commandCount++;
    for (const key of keys) {
      const existed =
        this.store.strings.delete(key) ||
        this.store.hashes.delete(key) ||
        this.store.zsets.delete(key);
      if (existed) this.bump(key);
    }
  }

  async exists(...keys: string[]): Promise<number> {
    this.commandCount++;
    let n = 0;
    for (const key of keys) {
      if (
        this.store.strings.has(key) ||
        this.store.hashes.has(key) ||
        this.store.zsets.has(key)
      ) {
        n++;
      }
    }
    return n;
  }

  async incrBy(key: string, value: number): Promise<number> {
    this.commandCount++;
    const current = Number.parseInt(this.store.strings.get(key) ?? '0', 10) || 0;
    const next = current + value;
    this.store.strings.set(key, String(next));
    this.bump(key);
    return next;
  }

  // --- hashes ----------------------------------------------------------------

  private hash(key: string): Map<string, string> {
    let h = this.store.hashes.get(key);
    if (!h) {
      h = new Map();
      this.store.hashes.set(key, h);
    }
    return h;
  }

  async hGet(key: string, field: string): Promise<string | undefined> {
    this.commandCount++;
    return this.store.hashes.get(key)?.get(field);
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    this.commandCount++;
    const h = this.store.hashes.get(key);
    const out: Record<string, string> = {};
    if (h) for (const [f, v] of h) out[f] = v;
    return out;
  }

  async hSet(key: string, fieldValues: { [field: string]: string }): Promise<number> {
    this.commandCount++;
    const h = this.hash(key);
    let added = 0;
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!h.has(f)) added++;
      h.set(f, v);
    }
    this.bump(key);
    return added;
  }

  async hSetNX(key: string, field: string, value: string): Promise<number> {
    this.commandCount++;
    const h = this.hash(key);
    if (h.has(field)) return 0;
    h.set(field, value);
    this.bump(key);
    return 1;
  }

  async hDel(key: string, fields: string[]): Promise<number> {
    this.commandCount++;
    const h = this.store.hashes.get(key);
    if (!h) return 0;
    let removed = 0;
    for (const f of fields) if (h.delete(f)) removed++;
    if (removed > 0) this.bump(key);
    return removed;
  }

  async hLen(key: string): Promise<number> {
    this.commandCount++;
    return this.store.hashes.get(key)?.size ?? 0;
  }

  async hKeys(key: string): Promise<string[]> {
    this.commandCount++;
    return [...(this.store.hashes.get(key)?.keys() ?? [])];
  }

  // --- zsets -----------------------------------------------------------------

  private zset(key: string): Map<string, number> {
    let z = this.store.zsets.get(key);
    if (!z) {
      z = new Map();
      this.store.zsets.set(key, z);
    }
    return z;
  }

  async zAdd(key: string, ...members: ZMemberLike[]): Promise<number> {
    this.commandCount++;
    const z = this.zset(key);
    let added = 0;
    for (const { member, score } of members) {
      if (!z.has(member)) added++;
      z.set(member, score);
    }
    this.bump(key);
    return added;
  }

  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptionsLike
  ): Promise<ZMemberLike[]> {
    this.commandCount++;
    const z = this.store.zsets.get(key);
    if (!z) return [];
    const sorted = [...z.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
    if (options?.reverse) sorted.reverse();
    // rank-mode semantics only (all the server uses)
    const s = typeof start === 'number' ? start : Number.parseInt(start, 10);
    const e = typeof stop === 'number' ? stop : Number.parseInt(stop, 10);
    const from = s < 0 ? Math.max(0, sorted.length + s) : s;
    const to = e < 0 ? sorted.length + e : Math.min(e, sorted.length - 1);
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) return [];
    return sorted.slice(from, to + 1);
  }

  async zRem(key: string, members: string[]): Promise<number> {
    this.commandCount++;
    const z = this.store.zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (const m of members) if (z.delete(m)) removed++;
    if (removed > 0) this.bump(key);
    return removed;
  }

  async zScore(key: string, member: string): Promise<number | undefined> {
    this.commandCount++;
    return this.store.zsets.get(key)?.get(member);
  }

  async zCard(key: string): Promise<number> {
    this.commandCount++;
    return this.store.zsets.get(key)?.size ?? 0;
  }

  // --- transactions ------------------------------------------------------------

  /** Test hook: awaited between WATCH and EXEC apply — lets tests interleave. */
  pause: (() => Promise<void>) | null = null;

  async watch(...keys: string[]): Promise<TxLike> {
    this.commandCount++;
    const snapshot = new Map<string, number>(keys.map((k) => [k, this.version(k)]));
    const queue: QueuedOp[] = [];
    let inMulti = false;
    let done = false;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const stub = this;

    const tx: TxLike = {
      async multi(): Promise<void> {
        inMulti = true;
      },
      async exec(): Promise<unknown[] | null> {
        if (done) throw new Error('tx already finished');
        done = true;
        if (stub.pause) await stub.pause();
        for (const [key, version] of snapshot) {
          if (stub.version(key) !== version) return null; // WATCH tripped
        }
        const results: unknown[] = [];
        for (const op of queue) results.push(op());
        return results;
      },
      async discard(): Promise<void> {
        done = true;
        queue.length = 0;
      },
      async unwatch(): Promise<unknown> {
        snapshot.clear();
        return tx;
      },
      async set(key: string, value: string): Promise<unknown> {
        assertMulti();
        queue.push(() => {
          stub.store.strings.set(key, value);
          stub.bump(key);
          return 'OK';
        });
        return tx;
      },
      async del(...delKeys: string[]): Promise<unknown> {
        assertMulti();
        queue.push(() => {
          for (const key of delKeys) {
            const existed =
              stub.store.strings.delete(key) ||
              stub.store.hashes.delete(key) ||
              stub.store.zsets.delete(key);
            if (existed) stub.bump(key);
          }
          return delKeys.length;
        });
        return tx;
      },
      async hSet(key: string, fieldValues: { [field: string]: string }): Promise<unknown> {
        assertMulti();
        queue.push(() => {
          const h = stub.hash(key);
          let added = 0;
          for (const [f, v] of Object.entries(fieldValues)) {
            if (!h.has(f)) added++;
            h.set(f, v);
          }
          stub.bump(key);
          return added;
        });
        return tx;
      },
      async hSetNX(key: string, field: string, value: string): Promise<unknown> {
        assertMulti();
        queue.push(() => {
          const h = stub.hash(key);
          if (h.has(field)) return 0;
          h.set(field, value);
          stub.bump(key);
          return 1;
        });
        return tx;
      },
      async zAdd(key: string, ...members: ZMemberLike[]): Promise<unknown> {
        assertMulti();
        queue.push(() => {
          const z = stub.zset(key);
          let added = 0;
          for (const { member, score } of members) {
            if (!z.has(member)) added++;
            z.set(member, score);
          }
          stub.bump(key);
          return added;
        });
        return tx;
      },
      async zRem(key: string, members: string[]): Promise<unknown> {
        assertMulti();
        queue.push(() => {
          const z = stub.store.zsets.get(key);
          if (!z) return 0;
          let removed = 0;
          for (const m of members) if (z.delete(m)) removed++;
          if (removed > 0) stub.bump(key);
          return removed;
        });
        return tx;
      },
    };

    const assertMulti = (): void => {
      if (!inMulti) throw new Error('command queued outside MULTI');
      if (done) throw new Error('tx already finished');
    };

    return tx;
  }

  // --- test introspection ------------------------------------------------------

  /** Deterministic dump of the whole store (seed-determinism assertions). */
  dump(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of [...this.store.strings.entries()].sort()) out[`str:${k}`] = v;
    for (const [k, h] of [...this.store.hashes.entries()].sort()) {
      out[`hash:${k}`] = Object.fromEntries([...h.entries()].sort());
    }
    for (const [k, z] of [...this.store.zsets.entries()].sort()) {
      out[`zset:${k}`] = Object.fromEntries([...z.entries()].sort());
    }
    return out;
  }
}
