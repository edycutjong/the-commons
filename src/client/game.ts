/**
 * The Commons — game webview client.
 *
 * Minimal, self-contained, framework-free. It drives the real demo loop against
 * the same server the tests exercise:
 *   read the dilemma   →  GET  /api/round
 *   seal a choice      →  POST /api/commit   (choice + stake + optional insurance)
 *   view the Reckonings →  GET  /api/history (the seeded feed, newest first)
 *
 * COLD-OPEN CHOREOGRAPHY (the magic moment, per AUDIT.md §4): a cold judge who
 * may never wait for a real midnight must still witness the "oh". So on load
 * the client LEADS with an animated reveal of the seeded catastrophe — the
 * most-participated `ruin` the crowd inflicted on itself ("58% hoarded. The pot
 * burned.") — bars sweeping in, verdict punching, a red flash. Then a TONIGHT
 * divider, tonight's dilemma with a live ticker, then the rest of the feed.
 *
 * This is intentionally NOT the full UI.md commit-side choreography (no
 * envelope/wax-seal animation, no Forge/Ladders sheets); it is the honest,
 * playable core plus the Reckoning reveal. It never imports server code and
 * never learns the split before settle — the server enforces that.
 */

import * as audio from './audio';

type MyCommit = { choice: string; stake: number; insured: boolean } | null;

type RoundView = {
  state: 'open' | 'interlude' | 'void';
  day: number;
  title: string;
  flavor: string;
  archetype: string;
  params: Record<string, number>;
  choices: string[];
  participants: number;
  pot: number;
  revealAt: number;
  preseason: boolean;
  author: string | null;
};

type MeView = {
  loggedIn: boolean;
  username: string | null;
  myCommit: MyCommit;
  balance: number;
  maxStake: number;
  insuranceCost: number;
  insuranceHeld: boolean;
  streak: { current: number; best: number };
  saintScore: number;
  serpentScore: number;
};

type RoundResponse = {
  round: RoundView | null;
  me: MeView;
  lastSettledDay: number | null;
  serverNow: number;
};

type OutcomeView = {
  day: number;
  title: string;
  verdict: string;
  detail: string;
  archetype: string;
  participants: number;
  pot: number;
  split: Record<string, number>;
  splitPct: Record<string, number>;
  groupOutcome: string;
  saints: string[];
  serpents: string[];
  preseason: boolean;
};

type MyResult = {
  choice: string;
  stake: number;
  delta: number;
  outcomeClass: string;
  note: string;
  insuranceSaved: boolean;
  streakAfter: number;
} | null;

type HistoryEntry = { outcome: OutcomeView; mine: MyResult };
type HistoryResponse = { entries: HistoryEntry[] };

type TickerMode = 'open' | 'sealed';

const app = document.getElementById('app') as HTMLElement;

let selectedChoice: string | null = null;
let countdownTimer: number | null = null;
let pollTimer: number | null = null;
let renderedLastSettledDay: number | null = null;
let loadedClientAt = Date.now();

/** Cooperative choice per archetype — mirrors the server's payoffs.json spec. */
const COOPERATIVE: Record<string, string | null> = {
  public_pot: 'FEED',
  stag_hunt: 'STAG',
  chicken: 'SWERVE',
  lowest_unique: null,
  exact_n: 'GUARD',
};

const pct = (f: number): string => `${Math.round((f ?? 0) * 100)}%`;
const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function payoffSentence(r: RoundView): string {
  const p = r.params;
  switch (r.archetype) {
    case 'public_pot':
      return `If ${pct(p.threshold ?? 0.7)}+ FEED, every stake multiplies (feeders ×${p.feedMult ?? 2}, hoarders ×${p.hoardMult ?? 3}). Fall short and the pot burns — every stake lost.`;
    case 'stag_hunt':
      return `${pct(p.threshold ?? 0.8)} must hold the STAG or the hunt fails. Hares always bank ×${p.hareMult ?? 1.5}; stags win ×${p.stagMult ?? 3} only if enough hold the line.`;
    case 'chicken':
      return `Darers win ×${p.dareMult ?? 3} — until too many dare (over ${pct(p.crashFrac ?? 0.5)}) and the road runs red. Swervers merely keep theirs (×${p.swerveMult ?? 1.25}).`;
    case 'lowest_unique':
      return `The rarest bid wins ×${p.winMult ?? 4}. Everyone else burns ${pct(p.loseFrac ?? 0.5)} of their stake.`;
    case 'exact_n':
      return `The vault opens only for a crew of ~${pct(p.targetFrac ?? 0.125)} (±${pct(p.band ?? 0.05)}). Crack it: ×${p.heistMult ?? 5}. Miss and heisters lose all; guards collect ×${p.guardMult ?? 1.5}.`;
    default:
      return r.flavor;
  }
}

function countdownText(revealAt: number, serverNow: number): string {
  const driftedNow = serverNow + (Date.now() - loadedClientAt);
  const ms = Math.max(0, revealAt - driftedNow);
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function tickerText(participants: number, pot: number, mode: TickerMode): string {
  if (mode === 'sealed') {
    return `${participants.toLocaleString()} souls sealed · pot ${pot.toLocaleString()}`;
  }
  if (participants === 0) return `be the first to seal tonight · pot 0`;
  return `${participants.toLocaleString()} souls · pot ${pot.toLocaleString()}`;
}

/** The plurality (most-common) choice in a settled split, or null if empty. */
function pluralityChoice(split: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const [choice, n] of Object.entries(split)) {
    if (n > bestN) {
      bestN = n;
      best = choice;
    }
  }
  return best;
}

/**
 * Pick the Reckoning to feature on cold open: the biggest SELF-INFLICTED
 * collapse — a `ruin` whose plurality choice was the non-cooperative one,
 * ranked by crowd size (most souls hurt). That lands on "58% hoarded. The pot
 * burned." (400 souls) over the 10-soul stag failure or the 69.4%-FED near
 * miss. Falls back to the newest settled round when nothing qualifies (e.g. a
 * young live sub with only cooperation wins).
 */
function pickFeatured(entries: HistoryEntry[]): number {
  let bestIdx = -1;
  let bestParticipants = -1;
  for (let i = 0; i < entries.length; i++) {
    const o = entries[i]?.outcome;
    if (!o || o.groupOutcome !== 'ruin') continue;
    const coop = COOPERATIVE[o.archetype] ?? null;
    const plurality = pluralityChoice(o.split);
    if (coop !== null && plurality !== null && plurality !== coop && o.participants > bestParticipants) {
      bestParticipants = o.participants;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) return bestIdx;
  return entries.length > 0 ? 0 : -1;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  return (await res.json()) as T;
}

function stopTimers(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function load(): Promise<void> {
  stopTimers();
  loadedClientAt = Date.now();
  app.innerHTML = `<div class="loading">Consulting the commons…</div>`;
  let round: RoundResponse;
  let history: HistoryResponse;
  try {
    [round, history] = await Promise.all([
      getJson<RoundResponse>('/api/round'),
      getJson<HistoryResponse>('/api/history?limit=6'),
    ]);
  } catch {
    app.innerHTML = `<div class="card error">The commons is unreachable. Pull to retry.</div>`;
    return;
  }
  render(round, history);
}

function render(data: RoundResponse, history: HistoryResponse): void {
  const { round, me, serverNow } = data;
  renderedLastSettledDay = data.lastSettledDay;

  const entries = history.entries ?? [];
  const featuredIdx = pickFeatured(entries);
  const featured = featuredIdx >= 0 ? entries[featuredIdx] : undefined;
  const committed = Boolean(round && me.myCommit);
  const parts: string[] = [];

  // 1 · COLD OPEN — lead with the animated catastrophe reveal (the "oh").
  //    Once the judge has committed, their sealed envelope leads instead.
  if (committed && round) {
    parts.push(sealedCard(round, me, serverNow));
    if (featured) parts.push(reckoningCard(featured.outcome, featured.mine, true));
  } else {
    if (featured) parts.push(reckoningCard(featured.outcome, featured.mine, true));
    // 2 · TONIGHT — the same mechanic, open right now.
    if (round && round.state === 'open') {
      parts.push(`<div class="divider"><span>TONIGHT</span></div>`);
      parts.push(dilemmaCard(round, me));
    } else if (round) {
      parts.push(`<div class="divider"><span>TONIGHT</span></div>`);
      parts.push(`<div class="card"><span class="badge">INTERLUDE</span><h1>${esc(round.title)}</h1><p class="flavor">The envelopes are sealed. Midnight has spoken; the next dilemma opens at 00:05 UTC.</p></div>`);
    } else {
      parts.push(`<div class="card"><h1>THE COMMONS</h1><p class="flavor">No dilemma is open yet. The first envelope is being prepared.</p></div>`);
    }
  }

  // 3 · THE FEED — proof this happens every night (retention loop, in-app).
  const rest = entries.filter((_, i) => i !== featuredIdx);
  if (rest.length > 0) {
    parts.push(`<div class="divider"><span>RECENT NIGHTS</span></div>`);
    for (const e of rest) parts.push(reckoningCard(e.outcome, e.mine, false));
  }

  parts.push(footer(me));
  app.innerHTML = parts.join('');
  wire(round, me);

  // Cold-open "oh": sound the featured catastrophe reveal (silent until the
  // first user gesture unlocks audio, per autoplay policy).
  if (!committed && featured) audio.reckoning(featured.outcome.groupOutcome);

  if (round && me.myCommit) startCountdown(round.revealAt, serverNow);
  if (round && round.state === 'open') startPoll(committed ? 'sealed' : 'open');
}

function dilemmaCard(r: RoundView, me: MeView): string {
  selectedChoice = selectedChoice && r.choices.includes(selectedChoice) ? selectedChoice : null;
  const choices = r.choices
    .map(
      (c) =>
        `<button class="choice ${selectedChoice === c ? 'sel' : ''}" data-choice="${esc(c)}">${esc(c)}</button>`
    )
    .join('');
  const badge = r.preseason ? `<span class="badge pre">PRESEASON</span>` : '';
  const author = r.author ? `<span class="byline">forged by u/${esc(r.author)}</span>` : '';
  const stakeInit = Math.min(10, me.maxStake);
  return `
    <div class="card dilemma">
      ${badge}${author}
      <h1>${esc(r.title)}</h1>
      <p class="flavor">${esc(r.flavor)}</p>
      <p class="payoff">${esc(payoffSentence(r))}</p>
      <div class="ticker" id="liveTicker">${tickerText(r.participants, r.pot, 'open')}</div>
      <div class="choices">${choices}</div>
      <label class="stake">Stake <output id="stakeOut">${stakeInit}</output>
        <input id="stake" type="range" min="0" max="${me.maxStake}" value="${stakeInit}" step="1" />
      </label>
      ${me.insuranceHeld
        ? `<div class="ins held">Streak insurance held — one bad night forgiven.</div>`
        : `<label class="ins"><input id="ins" type="checkbox" /> Buy streak insurance (${me.insuranceCost} pts)</label>`}
      <button id="seal" class="seal" ${me.loggedIn ? '' : 'disabled'}>${me.loggedIn ? 'SEAL MY CHOICE' : 'Log in to seal'}</button>
      <div id="err" class="err"></div>
    </div>`;
}

function sealedCard(r: RoundView, me: MeView, serverNow: number): string {
  const c = me.myCommit!;
  return `
    <div class="card sealed">
      <span class="badge ok">SEALED</span>
      <h1>Your envelope is sealed.</h1>
      <p class="flavor">You chose <b>${esc(c.choice)}</b> for <b>${c.stake}</b> pts${c.insured ? ' · insured' : ''}. One choice a night. No take-backs.</p>
      <div class="countdown">REVEAL IN <span id="cd">${countdownText(r.revealAt, serverNow)}</span></div>
      <div class="ticker" id="liveTicker">${tickerText(r.participants, r.pot, 'sealed')}</div>
      <div class="streak">🔥 streak ${me.streak.current} (best ${me.streak.best})</div>
      <p class="hint">You cannot learn your fate without coming back after midnight. That is the game.</p>
    </div>`;
}

function reckoningCard(o: OutcomeView, mine: MyResult, featured: boolean): string {
  const total = o.participants || 1;
  const bars = Object.keys(o.split)
    .map((k, i) => {
      const n = o.split[k] ?? 0;
      const w = Math.round((n / total) * 100);
      const delay = featured ? ` animation-delay:${(i * 0.1).toFixed(2)}s;` : '';
      return `<div class="bar"><span class="bl">${esc(k)}</span><span class="bt" style="width:${w}%;${delay}"></span><span class="bn">${o.splitPct[k] ?? 0}%</span></div>`;
    })
    .join('');
  const ceremony =
    o.saints.length || o.serpents.length
      ? `<div class="ceremony">${o.saints.length ? `<span class="chip saint">👼 ${o.saints.map((s) => 'u/' + esc(s)).join(', ')}</span>` : ''}${o.serpents.length ? `<span class="chip serpent">🐍 ${o.serpents.map((s) => 'u/' + esc(s)).join(', ')}</span>` : ''}</div>`
      : '';
  const personal = mine
    ? `<div class="mine ${mine.outcomeClass}">Your ${esc(mine.choice)} for ${mine.stake}: <b>${mine.delta >= 0 ? '+' : ''}${mine.delta}</b>${mine.insuranceSaved ? ' · insurance saved your streak' : ''}</div>`
    : '';
  const pre = o.preseason ? `<span class="badge pre">PRESEASON</span>` : '';
  const heroLabel = featured
    ? `<div class="hero-label">${o.groupOutcome === 'ruin' ? 'THE LAST TIME THE POT BURNED' : 'THE RECKONING THE COMMONS IS STILL ARGUING ABOUT'}</div>`
    : '';
  return `
    <div class="card reckoning ${o.groupOutcome}${featured ? ' featured' : ''}">
      ${heroLabel}${pre}<h2>THE RECKONING — ${esc(o.title)}</h2>
      <div class="verdict">${esc(o.verdict)}</div>
      <div class="detail">${esc(o.detail)} · ${o.participants.toLocaleString()} souls · pot ${o.pot.toLocaleString()}</div>
      <div class="bars">${bars}</div>
      ${ceremony}
      ${personal}
    </div>`;
}

function footer(me: MeView): string {
  if (!me.loggedIn) return `<div class="foot">Not logged in · showing tonight's dilemma read-only</div>`;
  return `<div class="foot">u/${esc(me.username ?? '')} · ${me.balance.toLocaleString()} pts · 👼 ${me.saintScore} · 🐍 ${me.serpentScore}</div>`;
}

function wire(round: RoundView | null, me: MeView): void {
  const stake = document.getElementById('stake') as HTMLInputElement | null;
  const stakeOut = document.getElementById('stakeOut') as HTMLOutputElement | null;
  if (stake && stakeOut) stake.addEventListener('input', () => (stakeOut.value = stake.value));

  app.querySelectorAll<HTMLButtonElement>('.choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedChoice = btn.dataset.choice ?? null;
      app.querySelectorAll('.choice').forEach((b) => b.classList.remove('sel'));
      btn.classList.add('sel');
      audio.select();
    });
  });

  const seal = document.getElementById('seal') as HTMLButtonElement | null;
  if (seal && round && me.loggedIn) {
    seal.addEventListener('click', () => void commit(stake));
  }
}

async function commit(stake: HTMLInputElement | null): Promise<void> {
  const err = document.getElementById('err') as HTMLElement | null;
  if (!selectedChoice) {
    if (err) err.textContent = 'Pick a choice first.';
    return;
  }
  const ins = document.getElementById('ins') as HTMLInputElement | null;
  const seal = document.getElementById('seal') as HTMLButtonElement | null;
  if (seal) {
    seal.disabled = true;
    seal.textContent = 'Sealing…';
  }
  try {
    const res = await fetch('/api/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        choice: selectedChoice,
        stake: stake ? Number(stake.value) : 0,
        buyInsurance: ins?.checked === true,
      }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { message?: string };
      if (err) err.textContent = body.message ?? 'The seal was refused.';
      if (seal) {
        seal.disabled = false;
        seal.textContent = 'SEAL MY CHOICE';
      }
      return;
    }
    audio.seal();
    await load();
  } catch {
    if (err) err.textContent = 'Network error — the envelope did not seal.';
    if (seal) {
      seal.disabled = false;
      seal.textContent = 'SEAL MY CHOICE';
    }
  }
}

function startCountdown(revealAt: number, serverNow: number): void {
  const tick = (): void => {
    const cd = document.getElementById('cd');
    if (!cd) return;
    cd.textContent = countdownText(revealAt, serverNow);
  };
  countdownTimer = window.setInterval(tick, 1000);
}

/**
 * Live ticker: poll the sealed public projection every 4s so `souls · pot`
 * visibly climbs as other players seal during judging. The server also
 * broadcasts these two integers on the realtime `pot_ticker` channel; this
 * same-origin poll is the webview's reflection of that count (and never
 * carries the split — /api/round structurally cannot). If a live round settles
 * while the judge lingers, a full reload surfaces the fresh Reckoning.
 */
function startPoll(mode: TickerMode): void {
  pollTimer = window.setInterval(() => {
    void (async () => {
      let data: RoundResponse;
      try {
        data = await getJson<RoundResponse>('/api/round');
      } catch {
        return;
      }
      const settledAdvanced =
        data.lastSettledDay !== null &&
        (renderedLastSettledDay === null || data.lastSettledDay > renderedLastSettledDay);
      if (!data.round || data.round.state !== 'open' || settledAdvanced) {
        void load();
        return;
      }
      const t = document.getElementById('liveTicker');
      if (t) t.textContent = tickerText(data.round.participants, data.round.pot, mode);
    })();
  }, 4000);
}

audio.mountMuteButton();
{
  const unlockOnce = (): void => audio.unlock();
  document.addEventListener('pointerdown', unlockOnce, { once: true });
  document.addEventListener('keydown', unlockOnce, { once: true });
}

void load();
