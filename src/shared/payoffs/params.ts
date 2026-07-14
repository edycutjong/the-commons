import payoffsJson from './payoffs.json';
import type { Archetype, ArchetypeSpec, Economy, Params } from './types';

type PayoffsFile = {
  economy: Economy;
  archetypes: Record<string, ArchetypeSpec>;
};

const FILE = payoffsJson as unknown as PayoffsFile;

export const ECONOMY: Economy = FILE.economy;

export function archetypeSpec(archetype: Archetype): ArchetypeSpec {
  const spec = FILE.archetypes[archetype];
  if (!spec) throw new Error(`unknown archetype: ${archetype}`);
  return spec;
}

export function isArchetype(value: string): value is Archetype {
  return Object.prototype.hasOwnProperty.call(FILE.archetypes, value);
}

export function defaultParams(archetype: Archetype): Params {
  return { ...archetypeSpec(archetype).defaults };
}

export function choicesFor(archetype: Archetype): string[] {
  return [...archetypeSpec(archetype).choices];
}

export function isValidChoice(archetype: Archetype, choice: string): boolean {
  return archetypeSpec(archetype).choices.includes(choice);
}

/**
 * Clamp forge-submitted params onto the slider grid: unknown keys dropped,
 * missing keys defaulted, values clamped to [min, max] and snapped to step.
 * Pure and total — any JSON object in, a safe param set out.
 */
export function clampParams(archetype: Archetype, raw: unknown): Params {
  const spec = archetypeSpec(archetype);
  const out: Params = { ...spec.defaults };
  if (raw === null || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  for (const [key, slider] of Object.entries(spec.sliders)) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const clamped = Math.min(slider.max, Math.max(slider.min, value));
    const steps = Math.round((clamped - slider.min) / slider.step);
    const snapped = slider.min + steps * slider.step;
    // step arithmetic can wobble in float land; round to 6 dp for stability
    out[key] = Math.min(slider.max, Math.max(slider.min, Number(snapped.toFixed(6))));
  }
  return out;
}

/** Param value with a guaranteed numeric fallback from defaults. */
export function param(params: Params, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
