# DEMO — The Commons (judge path)

> **The magic moment (0:03).** On cold open — before the judge touches anything — the split bars sweep in and the verdict punches: **"58.0% hoarded. The pot burned."** with a red ruin-flash over *400 souls · pot 9,940*. In one beat the judge understands the whole game: a secret crowd choice produced a collective catastrophe. **The hook (≈0:20):** they seal their own choice and hit the wall — *"You cannot learn your fate without coming back after midnight. That is the game."* The reveal is the "oh"; their own sealed countdown is the retention.

The whole game in three taps and one return visit. Total time ≈ 30 seconds. Everything below is **deterministic** — the seed is a fixed fixture, so these exact numbers reproduce on every fresh install.

## Setup (once)

```bash
npm install && npm run build      # or: npm run check   (green gate)
npm run login                     # devvit login
npm run dev                       # devvit playtest r/TheCommonsGame
```

Then, in **r/TheCommonsGame**, run the mod menu action **"The Commons: Seed Preseason"**. This settles six labeled preseason rounds through the _real_ settle transaction and opens tonight's live round with an honest zero counter.

> Prefer to see the seeded state without a subreddit? `npm run seed:local` prints the six Reckonings, tonight's round, and the ladders from the in-memory engine.

## The 30-second walk

**1 · THE "OH" — the reveal fires on load (no waiting for midnight).** Open the post and the webview leads with an **animated** Reckoning of the seeded catastrophe — the biggest self-inflicted collapse in the feed, badged **PRESEASON**:

> **THE LAST TIME THE POT BURNED**
> **THE RECKONING — PRESEASON II — THE LONG WINTER**
> **58.0% hoarded. The pot burned.**  · 400 souls · pot 9,940
> The split bars sweep in, the verdict punches, a red flash. The crowd did this to itself.

You understand the whole game in one beat: a secret crowd choice produced a collective verdict. (Featured deterministically — the `ruin` whose plurality choice was non-cooperative, ranked by crowd size — so this exact card reproduces on every fresh seed.)

**2 · READ — the same mechanic, open right now.** Under a **TONIGHT** divider sits **THE BLACKOUT POT**:

> _Feed the pot and pray. If enough of you feed, every stake multiplies. Hoarders take triple — unless the hoarding tips the line, and everything burns._
> If 70%+ FEED, feeders ×2 and hoarders ×3; fall short and the pot burns.
> Ticker: **be the first to seal tonight · pot 0** (honest zero, reframed as an invitation — the ticker climbs live as souls seal).

**3 · COMMIT — seal one choice.** Tap **FEED** (or HOARD), drag the stake slider, optionally check insurance, tap **SEAL MY CHOICE**. The card flips to the sealed state:

> **SEALED** — _You chose FEED for 10 pts. One choice a night. No take-backs._
> **REVEAL IN 05:59:xx** (counts down to the next 00:00 UTC settle) · **1 soul sealed**
> _You cannot learn your fate without coming back after midnight. That is the game._

There is no way — in the UI or the API — to see how anyone else voted. That secrecy is the game. Below, the rest of the seeded feed (**RECENT NIGHTS**) scrolls as proof this happens every night.

## Expected seeded outputs (verbatim)

| Round | Verdict | Souls | Note |
|---|---|---|---|
| **I — THE FIRST FIRE** | `83.3% fed. The pot held — every stake multiplied.` | 12 | clean cooperation win (triumph) |
| **II — THE LONG WINTER** | `58.0% hoarded. The pot burned.` | 400 | **the demo line** — catastrophe |
| **III — THE KNIFE'S EDGE** | `30.6% hoarded. The pot burned.` | 500 | 69.4% fed vs a 70% line — bled out by a hair |
| **IV — THE STAG** | `The hunt failed — only 10.0% held the line.` | 10 | **ash alone** held; this is the night that made a Saint |
| **V — THE QUIET NUMBER** | `BID 3 — held by only 11.1% — takes it.` | 9 | lowest-unique oddity (u/…gorse takes it) |
| **VI — THE HEIST** | `The vault opened. A crew of 12.5% walked out rich.` | 8 | exact-N heist success (u/…laurel cracks it) |

**Ladders after seeding:** Saints — `commons_founder_ash (55)` on top; Serpents — `commons_founder_laurel (25)` on top; **500 souls banked**. Run the mod **weekly-ceremony** cron and ash is crowned Saint, laurel Serpent, scores decay ×0.8 (55→44, 25→20). Synthetic preseason founders (`u/commons_founder_*`) are clearly badged **PRESEASON** and never receive real flair.

## What to notice

- **The split is never visible before settle** — check `/api/round`'s JSON: only `participants` and `pot`, no per-choice counts. `tests/endpoints.test.ts` proves this for every viewer.
- **Idempotence:** run **Force Settle** twice — the outcome is byte-identical. Re-run **Seed Preseason** — the store is restored exactly.
- **Consequences are social:** Saints/Serpents are named in the stickied Reckoning comment and wear weekly flair; the comment thread becomes the propaganda layer.
