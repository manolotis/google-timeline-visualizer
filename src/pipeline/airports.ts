/**
 * Flight extras: nearest-airport naming and the CO2 estimate.
 *
 * Airport data is vendored from OurAirports (public domain / Unlicense, see
 * https://ourairports.com/data/), trimmed by scripts/generate-airports.ts to
 * large_airport + medium_airport rows with an IATA code (that script also
 * documents the exact source URL and how to regenerate the file). Committed
 * at scripts/data/airports.json and handed to the pipeline by its caller —
 * no network fetch at preprocess or app runtime (see CLAUDE.md).
 */
import type { AirportEntry, MatchedAirport } from './types';
import { haversineDist } from './util';

/** A flight endpoint counts as "at" an airport within this radius. */
const AIRPORT_MATCH_RADIUS_KM = 40;
/** Effective-distance discount for a large airport: lets a major hub win a
 *  near-tie against a closer small/medium field a few km nearer. */
const AIRPORT_LARGE_BONUS_KM = 5;

/** Nearest airport within AIRPORT_MATCH_RADIUS_KM; large airports favored on near-ties. */
export function findNearestAirport(
  lat: number,
  lng: number,
  airports: AirportEntry[],
): MatchedAirport | null {
  let best: AirportEntry | null = null;
  let bestScore = Infinity;
  for (const a of airports) {
    const dist = haversineDist(lat, lng, a.lat, a.lng);
    if (dist > AIRPORT_MATCH_RADIUS_KM) continue;
    const score = dist - (a.size === 'large' ? AIRPORT_LARGE_BONUS_KM : 0);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ? { iata: best.iata, name: best.name } : null;
}

// ---------------------------------------------------------------------------
// CO2 estimate (flights)
// ---------------------------------------------------------------------------
// Simple distance-based model, DEFRA-style:
//
//   1. Flown distance = great-circle distance between the flight's endpoints
//      + a fixed 95 km detour correction (real routes aren't great circles —
//      airway routing, holding, weather; ~95 km is a standard correction for
//      indirect routing used by DEFRA/ICAO-style methodologies).
//   2. A per-km emission factor (kg CO2 per passenger-km, economy class,
//      *excluding* radiative forcing) by haul, bucketed on the *raw*
//      great-circle distance:
//        - short  (< 1,500 km):        0.15100 kg/km
//        - medium (1,500–4,000 km):    0.13402 kg/km
//        - long   (> 4,000 km):        0.11704 kg/km
//      The short and long figures are UK DEFRA/DESNZ's 2024 "Government
//      greenhouse gas conversion factors for company reporting" economy-class
//      passenger-flight factors (excl. RF) for international short-haul
//      (< 3,700 km) and long-haul (> 3,700 km) respectively. DEFRA doesn't
//      publish a medium-haul band; ours is the midpoint of those two, as a
//      simple model of the gradual efficiency gain from a longer cruise
//      phase between the short- and long-haul figures.
//      Source: DEFRA/DESNZ "2024 Government greenhouse gas conversion
//      factors for company reporting", Passenger flights table
//      (assets.publishing.service.gov.uk/media/66a9fe4ca3c2a28abb50da4a/
//      2024-greenhouse-gas-conversion-factors-methodology.pdf).
//   3. Multiply by a radiative-forcing multiplier of 1.9 (DEFRA's own RF
//      uplift, ~1.891, commonly rounded to 1.9) to account for aviation's
//      non-CO2 warming effects (contrails, NOx, cirrus formation), giving a
//      CO2e ("CO2 equivalent") figure.
const CO2_DETOUR_KM = 95;
const CO2_RF_MULTIPLIER = 1.9;
const CO2_FACTOR_SHORT_KG_PER_KM = 0.151;
const CO2_FACTOR_MEDIUM_KG_PER_KM = 0.13402;
const CO2_FACTOR_LONG_KG_PER_KM = 0.11704;
const CO2_SHORT_MAX_KM = 1500;
const CO2_MEDIUM_MAX_KM = 4000;

/** kg CO2e for a flight, from the great-circle distance (km) between its endpoints. */
export function estimateFlightCo2Kg(greatCircleKm: number): number {
  const factor =
    greatCircleKm < CO2_SHORT_MAX_KM ? CO2_FACTOR_SHORT_KG_PER_KM
    : greatCircleKm <= CO2_MEDIUM_MAX_KM ? CO2_FACTOR_MEDIUM_KG_PER_KM
    : CO2_FACTOR_LONG_KG_PER_KM;
  const flownKm = greatCircleKm + CO2_DETOUR_KM;
  return Math.round(flownKm * factor * CO2_RF_MULTIPLIER * 10) / 10;
}
