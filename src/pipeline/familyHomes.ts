/**
 * Family homes (timeline-config.json).
 *
 * A family home is a place you stay at again and again without living there,
 * like your parents' house every Christmas and summer. Nothing in the export
 * tells it apart from any other destination, so it is configured by hand in
 * the optional timeline-config.json (it holds personal coordinates: the CLI
 * reads a gitignored file, the in-browser import keeps it in IndexedDB):
 *
 *   { "familyHomes": [{ "lat": 48.8584, "lng": 2.2945, "label": "Parents", "radiusKm": 1 }] }
 *
 * A night that would be away but was spent within radiusKm of a family home
 * is a family night: not away (isHome stays true, so nothing counts it as a
 * night away, and trips end at it like at home) but marked with the family
 * home's label (`family`). Its distKm is still measured from the period's
 * home. A night at home is never a family night, so while a family home is
 * also the home of the period (you moved in), its nights are simply home.
 *
 * Dependency-free apart from haversineDist, so the main thread can validate
 * a pasted config without loading the pipeline.
 */
import type { FamilyHome, FamilyHomeConfig, TimelineConfig } from './types';
import { haversineDist } from './util';

/**
 * Parses and validates the text of a timeline-config.json. A malformed file
 * throws (with `name` in the message) rather than quietly counting every stay
 * there as away; unknown keys are reported through `warn` and ignored.
 */
export function parseTimelineConfig(
  text: string,
  name = 'timeline-config.json',
  warn: (message: string) => void = () => {},
): FamilyHomeConfig[] {
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse ${name}: ${(err as Error).message}`, { cause: err });
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`${name} must hold a JSON object, e.g. { "familyHomes": [] }`);
  }
  const known: (keyof TimelineConfig)[] = ['familyHomes'];
  for (const key of Object.keys(config)) {
    if (!known.includes(key as keyof TimelineConfig)) warn(`  Ignoring unknown key "${key}" in ${name}`);
  }

  const list = (config as Record<string, unknown>).familyHomes;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`${name}: "familyHomes" must be an array`);
  return list.map((entry: unknown, i): FamilyHomeConfig => {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const { lat, lng, label, radiusKm } = e;
    const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (
      !isNumber(lat) || Math.abs(lat) > 90 ||
      !isNumber(lng) || Math.abs(lng) > 180 ||
      (label !== undefined && typeof label !== 'string') ||
      (radiusKm !== undefined && !(isNumber(radiusKm) && radiusKm > 0))
    ) {
      throw new Error(
        `${name}: familyHomes[${i}] needs numeric "lat" and "lng" (degrees), ` +
          'plus optionally a "label" (text) and a "radiusKm" (> 0)',
      );
    }
    return { lat, lng, label, radiusKm };
  });
}

/** The family home a place lies within, the nearest one if several; null if none. */
export function familyHomeAt(homes: FamilyHome[], lat: number, lng: number): FamilyHome | null {
  let best: FamilyHome | null = null;
  let bestDist = Infinity;
  for (const h of homes) {
    const d = haversineDist(h.lat, h.lng, lat, lng);
    if (d < h.radiusKm && d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}
