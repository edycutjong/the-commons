/**
 * Forge flavor-text filter. Constrained UGC is the whole abuse plan:
 * ≤140 chars, printable single-line text, wordlist-screened after
 * normalization (case folding, leetspeak collapse, separator stripping).
 * No free-form content reaches the daily post except through this gate +
 * the mod approval queue.
 */

const MAX_FLAVOR = 140;
const MAX_TITLE = 48;

// Compact denylist of slurs/abuse stems (normalized form). Deliberately
// conservative: forge text is also mod-approved before rotation.
const BANNED_STEMS: readonly string[] = [
  'nigger',
  'nigga',
  'faggot',
  'kike',
  'spic',
  'chink',
  'wetback',
  'tranny',
  'retard',
  'rape',
  'rapist',
  'nazi',
  'hitler',
  'kys',
  'killyourself',
  'cunt',
  'porn',
  'sexwith',
  'childsex',
  'pedo',
  'heilhitler',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's',
  '!': 'i',
};

export function normalizeForFilter(text: string): string {
  const folded = text.toLowerCase();
  let out = '';
  for (const ch of folded) {
    const mapped = LEET[ch] ?? ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

export type FilterVerdict = { ok: true } | { ok: false; reason: string };

export function checkFlavorText(text: string): FilterVerdict {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: 'Flavor text is required.' };
  }
  if (text.length > MAX_FLAVOR) {
    return { ok: false, reason: `Flavor text must be ${MAX_FLAVOR} characters or fewer.` };
  }
  if (/[\r\n\t]/.test(text)) {
    return { ok: false, reason: 'Flavor text must be a single line.' };
  }
  // Printable guard: reject control chars.
  for (const ch of text) {
    /* v8 ignore next -- `for...of` over a string always yields a non-empty code-point substring, so codePointAt(0) is always defined here; the ?? 0 fallback is structurally unreachable */
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      return { ok: false, reason: 'Flavor text contains control characters.' };
    }
  }
  const normalized = normalizeForFilter(text);
  for (const stem of BANNED_STEMS) {
    if (normalized.includes(stem)) {
      return { ok: false, reason: 'Flavor text was rejected by the wordlist filter.' };
    }
  }
  return { ok: true };
}

export function checkTitle(text: string): FilterVerdict {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, reason: 'Title is required.' };
  }
  if (text.length > MAX_TITLE) {
    return { ok: false, reason: `Title must be ${MAX_TITLE} characters or fewer.` };
  }
  return checkFlavorText(text); // same screening rules
}

export const FLAVOR_LIMIT = MAX_FLAVOR;
export const TITLE_LIMIT = MAX_TITLE;
