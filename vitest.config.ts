import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Scoped to the pure/testable layers: shared domain logic (payoff
      // engine, economy, api types) and the server core + routes (all
      // mockable via the Deps container / RedisStub + FakeReddit/FakeRealtime
      // test doubles, no live Devvit runtime needed). src/client/** (React
      // webview, needs a real browser to render) and src/server/index.ts
      // (process bootstrap — calls serve() at import time, the ONLY file
      // that touches @devvit/web/server) are excluded on purpose: they need
      // a real browser/runtime to exercise meaningfully, same "client is
      // playable core, not full UI" caveat as the README's Honest Limitations.
      include: ['src/shared/**/*.ts', 'src/server/core/**/*.ts', 'src/server/routes/**/*.ts'],
      // src/server/core/deps.ts + redis.ts are pure `export type` files (the
      // Deps/RedisLike/TxLike structural contracts) — every declaration is
      // erased at compile time, leaving zero runtime statements. The v8
      // coverage provider on this vitest major reports such empty modules as
      // a literal 0% (rather than vacuously 100% or omitting the row), so
      // they're excluded here — there is no executable line to ever cover.
      exclude: ['src/client/**', 'src/server/index.ts', 'src/server/core/deps.ts', 'src/server/core/redis.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
