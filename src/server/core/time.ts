/** UTC day math. A "day" is the UTC epoch-day number; settle fires at 00:00 UTC. */

export const DAY_MS = 86_400_000;

export function dayOf(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** Unix ms of the next 00:00 UTC strictly after `ms` — the reveal moment. */
export function nextMidnightUtc(ms: number): number {
  return (dayOf(ms) + 1) * DAY_MS;
}

export function dayStartMs(day: number): number {
  return day * DAY_MS;
}

/** ISO date label (YYYY-MM-DD) for a day number. */
export function dayLabel(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** ISO week-ish index used to seed the Wildcard pick. */
export function weekOf(day: number): number {
  return Math.floor(day / 7);
}
