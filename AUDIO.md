# AUDIO — The Commons (IMPLEMENTED 2026-07-14)

Status: **shipped (SFX)**. Procedural Web Audio one-shots are wired into the
client — no asset files, no external fetch, so it respects the empty `http`
allowlist and works offline. Implementation: `src/client/audio.ts`; cues fire
from `src/client/game.ts` (cold-open ruin/triumph reveal, seal, choice-select).
A mute toggle sits top-right and audio unlocks on the first tap (the cold-open
reveal cue is silent until then, per autoplay policy). Background music is
deliberately **not** shipped this pass (SFX-only) — it remains optional per the
sections below. The cue table below is now the wired map, not a draft.

## Feasibility (verified so far, audited)

- Devvit's client is a real Chromium webview (full `lib.dom.d.ts` available
  in the build — `HTMLAudioElement`, `AudioContext`, etc.). `devvit.json`'s
  config schema has no CSP field — that means this repo doesn't set one, not
  that none applies. **The real Content-Security-Policy is set by Reddit's
  host page at runtime and is not verifiable from this repo.**
- **Not officially confirmed** by any crawled Devvit doc: whether Reddit's
  mobile-app embedded webview wrapper has its own autoplay/audio quirks on
  top of standard browser autoplay policy. Treat the first `devvit playtest`
  as the real test, not this doc.
- Hard constraints regardless of source:
  - **Correction:** this project's `devvit.json` has **no `http` key at all**
    (permissions = `redis`/`realtime`/`reddit` only) — an earlier draft of
    this doc claimed `http.enable: false` was present, which isn't accurate
    for this project. The practical rule still holds regardless (bundle
    every asset into `dist/client/`, never fetch from an external CDN) — it's
    just the safe default absent an explicit allowlist, not a cited setting.
  - Browser autoplay policy — sound can't start until after a user gesture
    (the first tap to commit a choice satisfies this).
  - `localStorage` wiped on app updates isn't independently documented in
    this project either — treat as inherited platform behavior, not a
    verified fact specific to The Commons.
  - **Splash (`inline: true`) vs expanded game view are different UX
    surfaces** — scope audio to the expanded view a player explicitly opened.
  - Not addressed yet: pausing `AudioContext` on `visibilitychange` and
    `.resume()` inside the gesture handler (iOS). No accessibility fallback
    planned for cues.
  - **Corrected secrecy framing:** `/api/commit`'s response already echoes
    the player's own `choice` back, and the client renders it directly
    (`sealedCard()` shows "You chose FEED for X pts" on the player's own
    screen right after committing) — the client was never meant to be
    choice-blind, and I1 ("no pre-settle leak") protects the **aggregate
    split from other players' devices**, not the committing player's own
    screen. A per-choice local sound reveals nothing to anyone that the
    player's own UI doesn't already show them. Keeping the commit SFX
    choice-independent is still reasonable **shoulder-surfing hygiene** (a
    sound someone nearby could hear/distinguish), but it is not required by
    invariant I1 and is not a security-critical constraint — demote to a
    nice-to-have, not a hard rule.

## SFX cue map

| Trigger | File location | Cue | Notes |
|---|---|---|---|
| Sealed commit submitted | `src/server/routes/api.ts` `/api/commit` handler → client `sealedCard()` in `game.ts` | Wax-seal "thunk" / envelope close | Recommend choice-independent as shoulder-surfing hygiene (see note above) — not an I1 requirement |
| Pot ticker increments (`souls · pot`) | realtime `pot_ticker` handler, `game.ts` | Tiny tick/blip, very subtle | High-frequency, keep minimal or it gets annoying |
| Reckoning reveal begins (bars sweep in) | `game.ts` `reckoningCard()` | Rising tension riser | Leads into the verdict punch |
| Reckoning verdict line lands ("58% hoarded. The pot burned.") | `game.ts` `reckoningCard()` | Punch/impact + red-flash sync | The magic-moment beat — highest-value single cue |
| ~~Weekly ceremony crowns Saint/Serpent~~ | **No client surface exists** — `game.ts` explicitly ships no Forge/Ladders sheets (Saint/Serpent data exists server-side only). Cut this cue, or scope a ladders UI first. | — | Removed from scope until the UI exists |

## Background music (optional, separate from SFX)

- **Loop**: low "midnight-violet" ambient bed under the dilemma card,
  ducked hard (or cut entirely) during the Reckoning reveal so the punch
  cue reads clearly.
- **Mute control required** if music ships — visible toggle in the client
  header.

## Generation approach (pick one before implementing)

1. **Web Audio synthesis (no asset files)** — the wax-seal thunk, tick, and
   tension riser are all well-suited to short synthesized cues. Zero
   generation cost, zero extra files.
2. **ElevenLabs sound-effects generation** — if the dedicated SFX endpoint
   is confirmed available, generates a more premium-feeling wax-seal/fanfare
   texture. Costs API credits; output files need to be committed and bundled
   by Vite.

Background music (if pursued) would use the `suno-music` skill regardless of
which SFX path is chosen.

## Open decision

Confirm before any implementation work starts:
1. SFX generation method (Web Audio synthesis vs ElevenLabs).
2. Whether background music ships at all, or SFX-only for this pass.
3. Priority order if time runs short — the Reckoning verdict punch is the
   one cue with real "magic moment" payoff; the rest are lower-priority
   polish. The ceremony cue has no client surface yet and is out of scope
   until a ladders UI exists.
