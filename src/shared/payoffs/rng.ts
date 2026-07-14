/**
 * Deterministic seeded RNG (xmur3 string hash -> mulberry32).
 * Used ONLY where the game explicitly wants seeded variety (e.g. the weekly
 * Wildcard pick). The payoff math itself never draws randomness — determinism
 * is invariant I3's foundation.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}

/** Deterministically pick one element (undefined for empty lists). */
export function seededPick<T>(seed: string, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  const rng = seededRng(seed);
  const idx = Math.floor(rng() * items.length) % items.length;
  return items[idx];
}
