# Contributing

Thanks for your interest in improving The Commons! 🕯️

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies: `npm install`
3. Run the green gate: `npm run check` (type-check + 126 vitest tests + build)
4. Log in to Devvit with the account that owns the app: `npm run login`
5. Playtest against your own dev subreddit: `npm run dev` (`devvit playtest`)

This is a **Reddit Devvit Web** app (Hono server + a framework-free webview), not
a Next.js/Vite site — there is no `localhost` dev server to open in a browser;
`npm run dev` builds and syncs the app into a live Devvit playtest subreddit.

## Before You Open a PR
- `npm run type-check` passes (`tsc --noEmit`, strict).
- `npm run test` passes (Vitest — currently 126 tests across 11 files).
- `npm run build` passes (Vite → `dist/client/{splash,game}.html` + `dist/server/index.cjs`).
- `npm run bench` stays under the settle-latency budget (10k-commit p95 < 2s).
- `npm run check` (or `check:submission`) passes — the submission-readiness
  compliance gate (no external fetch, zero runtime AI, no Reddit-vote-as-input,
  verified Devvit APIs only).
- Add or update tests for any behavior change, especially anything touching the
  payoff engine (`src/shared/payoffs/`) or the settle transaction
  (`src/server/core/settle.ts`).
- Keep commits conventional (`feat:`, `fix:`, `docs:`, `chore:`).

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include repro steps, expected vs.
actual behavior, and environment details (Node version, `devvit --version`).
