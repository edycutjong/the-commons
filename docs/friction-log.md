# Friction log — The Commons

Honest notes from the fix-and-complete pass. What broke, what I decided, and why.

## Starting state

The engine + server were ~90% there and well-tested (126 vitest cases). The failures were concentrated in three type errors, four assertion failures, an entirely missing webview client, and missing scripts/docs.

## TypeScript (4 errors, task flagged 3)

1. **Error-code union drift (`api.ts` / `shared/api.ts`).** `CommitErr` carries an internal `conflict` race code that `ApiError['code']` didn't, so the `/api/commit` status map couldn't be indexed by it. **Reconciled the two unions:** added `conflict` to `ApiError['code']` and mapped it to `409` in `CODE_STATUS`. `CommitErr['code']` is now a clean subset of `ApiError['code']`, so the handler passes `result.code` straight through (dropped the `as CommitErr` casts + the redundant ternary). At runtime `sealedCommit` still remaps `conflict → round_sealed` after its retries, so a client never actually sees it.
2. **`tests/helpers/env.ts` `postJson`.** Hono's `app.request` overload returns `Response | Promise<Response>`; the helper is typed `Promise<Response>`. Wrapped the call in `Promise.resolve(...)`.
3. **`src/server/index.ts` — undocumented 4th error.** The real `reddit.submitComment` requires `id: t1_${string} | t3_${string}` (template-literal), but `RedditLike` deliberately loosens it to `string` for testability, so the client wasn't assignable. Bridged it with `reddit as unknown as RedditLike` at the single Devvit boundary — exactly the pattern already used for `redis`. Confirmed the real signature against the verified `.d.ts` cache rather than guessing.

## Test failures (4) — root-caused, not hardcoded

1. **`reputation.test.ts` — safe hare (serpent 10 vs 15).** The module's own doc says the +5 serpent bonus is _"the heist case"_ (profit carved out of a losing commons), but the code applied +5 to **any** defection win in a losing commons — so a stag-hunt HARE (a safe, non-predatory defection) wrongly got 15. **Restricted the +5 to `archetype === 'exact_n'`.** This matches every reputation test and keeps `laurel`'s Serpent total at exactly 25 (10 from the round-I hoard + 15 from the round-VI heist), which the seed test asserts.

2 & 3. **`seed.test.ts` — "ash the saint" resolved to gorse.** SEED_DATA.md mandates ash as the top Saint, but the fixture made **seven** founders tie at Saint 55 (they made identical cooperative choices every round), and Redis `ZRANGE … REV` breaks score ties by _reverse-lexicographic_ order → `gorse` won. Confirmed the 7-way tie with a throwaway dump script. **Fixed the seed, not the test** (per SEED_DATA): in **PRESEASON IV — THE STAG**, the six other founders now break for the safe hare and **ash alone holds the line** (1 STAG / 9 HARE). Ash keeps its Saint point that night; the other six drop to 45; ash is the unique max at 55. The hunt still fails (`10% < 80%`, verdict still contains _"The hunt failed"_), no asserted percentage moved, and the change _strengthens_ the narrative — it's literally the night that made a Saint. Re-verified with the dump: `ash(55)` alone on top, `laurel(25)` top Serpent, 500 souls banked.

4. **`endpoints.test.ts` — `synthetic_` leak.** The sealed-shape test banned any `synthetic_` string in `/api/history`, but the summary's `saints`/`serpents` arrays are a **designed public feature** — the Reckoning names them, and `settle.test.ts:198` explicitly validates that naming (using the same `synthetic_*` harness usernames). The real invariant is "no per-user _dump_": history returns the public summary + only the viewer's own row, never other players' userIds. **Tightened the sweep** to assert that (no `t2_syn_` userIds, and specific un-crowned crowd members absent) while allowing the curated top-3 public Saints. This preserves the security meaning without fighting the game's own design.

## The missing client (biggest gap)

`src/client/` existed but was **empty**, so `npm run build` failed on the `splash.html` / `game.html` entrypoints (the `@devvit/start` vite plugin roots the client at `src/client` when it exists). Built a **minimal, framework-free, self-contained** client that drives the real loop — `GET /api/round` → render dilemma, `POST /api/commit` → sealed state + countdown, `GET /api/history` → the Reckoning with split bars and ceremony chips — in the midnight-violet design language. It imports **no** server code (the plugin errors on that) and uses only same-origin fetch (CSP-clean). It is deliberately not the full UI.md choreography; the Forge/Ladders screens are unbuilt (their APIs are done and tested). Build now emits exactly the `dist/` layout `devvit.json` expects.

## Scripts

- **`bench.mjs` gotcha:** `node:module`'s `register('tsx/esm', …)` is dead ("must be loaded with `--import`"). Switched to tsx's own `register()` from `tsx/esm/api`, which sets up the ESM hooks correctly under plain `node`. The bench reuses `tests/helpers/synth.ts` — whose header already declares it's shared with `scripts/bench.mjs`.
- Added `check_submission_readiness.mjs` (files + `devvit.json` + compliance greps: no plain lists/sets, zero AI, no Reddit votes, empty fetch allowlist, verified-reddit-surface-only + optional tsc/test/build) and `seed-local.mjs` (so no npm script dangles).

## Measured results

`tsc --noEmit` clean · `vitest run` 126/126 · `vite build` OK · settle p50/p95 (RedisStub): 100 → 0.4/1.0ms, 1k → 3.7/10.3ms, 10k → 38.6/60.9ms (PRD budget 2s, ~33× headroom).

## Not done (human step)

`devvit login` + `devvit playtest` + the subreddit ban/unban round-trip — see the First playtest checklist in the README. New hackathon subs are being auto-banned on install; front-load that on day one.
