/**
 * Procedural SFX for The Commons — Web Audio synthesis, zero asset files.
 *
 * The app declares no external `http` domains, so audio must be same-origin and
 * bundled. Oscillator/noise one-shots are generated at runtime: nothing to
 * fetch, nothing to ship, works offline. Cues match the reveal choreography in
 * game.html (the "pot burned" catastrophe, the sealed envelope).
 *
 * Autoplay policy: audio cannot start before a user gesture. `unlock()` resumes
 * the context on the first tap; the cold-open reveal cue is a no-op until then
 * (and forever if muted or if Web Audio is unavailable — SSR / tests).
 */

type Ctor = typeof AudioContext;

const AudioCtor: Ctor | undefined =
  typeof window !== 'undefined'
    ? (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext)
    : undefined;

const MUTE_KEY = 'commons_muted';

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function getCtx(): AudioContext | null {
  if (AudioCtor === undefined) return null;
  if (ctx === null) {
    try {
      ctx = new AudioCtor();
    } catch {
      return null;
    }
  }
  return ctx;
}

export function unlock(): void {
  const c = getCtx();
  if (c !== null && c.state === 'suspended') void c.resume();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    sessionStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* storage may be blocked; in-memory flag still holds for the session */
  }
}

type ToneOpts = {
  type: OscillatorType;
  freq: number;
  slideTo?: number;
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
};

function tone(o: ToneOpts): void {
  const c = getCtx();
  if (c === null || muted) return;
  const now = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, now);
  if (o.slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), now + o.dur);
  }
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + o.dur + 0.03);
}

type NoiseOpts = {
  dur: number;
  gain?: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterTo?: number;
  delay?: number;
};

function noise(o: NoiseOpts): void {
  const c = getCtx();
  if (c === null || muted) return;
  const now = c.currentTime + (o.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * o.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = o.filterType ?? 'bandpass';
  filt.frequency.setValueAtTime(o.filterFreq ?? 800, now);
  if (o.filterTo !== undefined) {
    filt.frequency.exponentialRampToValueAtTime(Math.max(1, o.filterTo), now + o.dur);
  }
  const g = c.createGain();
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, now + o.dur);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(now);
  src.stop(now + o.dur + 0.03);
}

// ── cues ─────────────────────────────────────────────────────────────────────

/** Cold-open catastrophe — "the pot burned": a deep collapsing boom + fire swell. */
export function ruin(): void {
  tone({ type: 'sine', freq: 110, slideTo: 36, dur: 0.7, gain: 0.4 });
  noise({ dur: 0.6, filterType: 'lowpass', filterFreq: 900, filterTo: 120, gain: 0.16 });
}

/** Cold-open cooperation win (fallback featured) — a warm rising two-note. */
export function triumph(): void {
  tone({ type: 'triangle', freq: 392, dur: 0.18, gain: 0.16 });
  tone({ type: 'triangle', freq: 587.33, dur: 0.28, gain: 0.16, delay: 0.1 });
}

/** Reveal the featured Reckoning: ruin (burn) or a cooperation triumph. */
export function reckoning(groupOutcome: string): void {
  if (groupOutcome === 'ruin') ruin();
  else triumph();
}

/** Sealing your envelope — a low, final "thunk". */
export function seal(): void {
  tone({ type: 'square', freq: 160, slideTo: 88, dur: 0.16, gain: 0.26 });
  noise({ dur: 0.05, filterType: 'lowpass', filterFreq: 500, gain: 0.1 });
}

/** Selecting a choice — a subtle tick. */
export function select(): void {
  tone({ type: 'triangle', freq: 660, dur: 0.05, gain: 0.09 });
}

/** Mounts a fixed mute toggle in the top-right corner. */
export function mountMuteButton(): void {
  if (typeof document === 'undefined' || document.body === null) return;
  if (document.getElementById('audio-mute') !== null) return;
  const btn = document.createElement('button');
  btn.id = 'audio-mute';
  btn.type = 'button';
  btn.style.cssText =
    'position:fixed;top:10px;right:10px;z-index:9999;appearance:none;' +
    'border:1px solid rgba(255,255,255,0.22);background:rgba(8,6,17,0.6);color:#ece8ff;' +
    'font-size:15px;line-height:1;width:32px;height:32px;border-radius:50%;cursor:pointer;' +
    'padding:0;display:flex;align-items:center;justify-content:center;' +
    '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);';
  const paint = (): void => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    btn.setAttribute('aria-pressed', String(muted));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMuted(!muted);
    paint();
    if (!muted) {
      unlock();
      select();
    }
  });
  paint();
  document.body.appendChild(btn);
}
