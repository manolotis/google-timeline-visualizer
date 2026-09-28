/**
 * Preprocessing script for Google Maps Timeline data.
 *
 * Reads the raw Timeline.json export and produces lightweight derived JSON
 * files in public/data/ that the frontend dashboard consumes.
 *
 * Generated files:
 *   - home.json        — Home periods over time (where you lived, and when),
 *                        detected from HOME / INFERRED_HOME visits and nights
 *   - flights.json     — Flight segments with coords, distance, duration, and paths
 *   - visits.json      — Deduplicated places with counts, time spent, and dated stays
 *   - nights-away.json — Per-date home/away classification against the home
 *                        period active that night
 *   - geography.json   — Countries (with ISO codes matched against
 *                        public/world-countries.geo.json), the city of every
 *                        away night, and the countries present on every date
 *   - trips.json       — Consecutive away-nights grouped into trips
 *   - routes.json      — All activity segments with polyline paths (downsampled)
 *   - stats.json       — Column-oriented log of every activity (date, hour, mode,
 *                        distance, duration) for client-side aggregation
 *
 * Everything the dashboard shows depends on the global time-range filter, so
 * this script emits dated per-record data rather than all-time totals; the
 * frontend (src/aggregate.ts) sums whatever falls inside the selected range.
 * Every date is a local calendar date where the user was at the time, taken
 * from the export's per-segment UTC offsets (see "Local time" below).
 *
 * Usage: npm run preprocess
 */
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

const ENV = process.env;

// ---------------------------------------------------------------------------
// Types matching the raw Timeline.json schema
// ---------------------------------------------------------------------------
interface RawSegment {
  startTime: string;
  endTime: string;
  startTimeTimezoneUtcOffsetMinutes?: number;
  endTimeTimezoneUtcOffsetMinutes?: number;
  timelinePath?: { point: string; time: string }[];
  visit?: {
    hierarchyLevel: number;
    probability: number;
    topCandidate: {
      placeId?: string;
      semanticType?: string;
      probability: number;
      placeLocation?: { latLng: string };
    };
  };
  activity?: {
    start: { latLng: string };
    end: { latLng: string };
    distanceMeters: number;
    topCandidate: { type: string; probability: number };
  };
}

interface RawTimeline {
  semanticSegments: RawSegment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseLatLng(s: string): [number, number] {
  // "40.6013752°, -3.7080549°" → [40.6013752, -3.7080549]
  const parts = s.replace(/°/g, '').split(',').map((p) => parseFloat(p.trim()));
  return [parts[0], parts[1]];
}

function haversineDist(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Airport data (flights): nearest-airport naming
// ---------------------------------------------------------------------------
// Vendored from OurAirports (public domain / Unlicense, see
// https://ourairports.com/data/), trimmed by scripts/generate-airports.ts to
// large_airport + medium_airport rows with an IATA code (that script also
// documents the exact source URL and how to regenerate the file). Committed
// at scripts/data/airports.json; this is the only place it's read — no
// network fetch at preprocess or app runtime (see CLAUDE.md).
interface AirportEntry {
  iata: string;
  name: string;
  lat: number;
  lng: number;
  municipality: string;
  size: 'large' | 'medium';
}

function loadAirports(filePath: string): AirportEntry[] {
  if (!fs.existsSync(filePath)) {
    console.warn(
      `  Airport data not found at ${filePath}; flights won't get airport names/CO2. ` +
        'Run: npx tsx scripts/generate-airports.ts',
    );
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AirportEntry[];
}

/** A flight endpoint counts as "at" an airport within this radius. */
const AIRPORT_MATCH_RADIUS_KM = 40;
/** Effective-distance discount for a large airport: lets a major hub win a
 *  near-tie against a closer small/medium field a few km nearer. */
const AIRPORT_LARGE_BONUS_KM = 5;

interface MatchedAirport {
  iata: string;
  name: string;
}

/** Nearest airport within AIRPORT_MATCH_RADIUS_KM; large airports favored on near-ties. */
function findNearestAirport(
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
function estimateFlightCo2Kg(greatCircleKm: number): number {
  const factor =
    greatCircleKm < CO2_SHORT_MAX_KM ? CO2_FACTOR_SHORT_KG_PER_KM
    : greatCircleKm <= CO2_MEDIUM_MAX_KM ? CO2_FACTOR_MEDIUM_KG_PER_KM
    : CO2_FACTOR_LONG_KG_PER_KM;
  const flownKm = greatCircleKm + CO2_DETOUR_KM;
  return Math.round(flownKm * factor * CO2_RF_MULTIPLIER * 10) / 10;
}

function durationMin(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60000;
}

function durationSec(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
}

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a 'YYYY-MM-DD' key (calendar arithmetic, no timezone). */
function dayNumber(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;
}

/** Inverse of dayNumber. */
function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------
// The export writes every ISO timestamp in the exporting phone's time zone
// (a flight leaving San Francisco at 13:35 reads "…T22:35:57.000+01:00"), so
// a timestamp's own date prefix is not the local date where things happened.
// Each visit and activity also records the UTC offset where it started and
// ended (start/endTimeTimezoneUtcOffsetMinutes), and those are the source of
// truth for local time here. One convention everywhere:
//
//   - Every timestamp this script emits is re-expressed in the offset where
//     it happened (localStart / localEnd), so its 'YYYY-MM-DD' prefix is the
//     local calendar date and its hour the local hour. Stays, activities,
//     flights (departure), routes and home samples are dated by that prefix.
//   - Days present (geography.json) count each local date a visit spans.
//   - Nights are keyed by the local date of the evening they begin (§4).
//
// Segments without the offset fields (timelinePath-only ones) fall back to
// the offset written in the timestamp itself.

/** UTC offset in minutes written in an ISO timestamp ('+01:00' → 60, 'Z' → 0). */
function isoOffsetMinutes(iso: string): number {
  const m = /([+-])(\d\d):(\d\d)$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** The same instant written in another UTC offset: ('…T22:35:57.000+01:00', -480) → '…T13:35:57.000-08:00'. */
function withOffset(iso: string, offsetMinutes: number): string {
  const wallClock = new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wallClock}${offsetMinutes < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** UTC offset (minutes) where a segment started. */
function startOffsetMinutes(s: RawSegment): number {
  return s.startTimeTimezoneUtcOffsetMinutes ?? isoOffsetMinutes(s.startTime);
}

/** UTC offset (minutes) where a segment ended. */
function endOffsetMinutes(s: RawSegment): number {
  return s.endTimeTimezoneUtcOffsetMinutes ?? isoOffsetMinutes(s.endTime);
}

/** A segment's start in local time, e.g. '2024-12-10T13:35:57.000-08:00'. */
function localStart(s: RawSegment): string {
  return withOffset(s.startTime, startOffsetMinutes(s));
}

/** A segment's end in local time. */
function localEnd(s: RawSegment): string {
  return withOffset(s.endTime, endOffsetMinutes(s));
}

/** The 'YYYY-MM-DD' prefix: the local date, for a timestamp from localStart / localEnd. */
function dateStr(iso: string): string {
  return iso.slice(0, 10);
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

// ---------------------------------------------------------------------------
// Home periods
// ---------------------------------------------------------------------------
// People move, so "home" is a list of periods rather than one place. Google's
// HOME / INFERRED_HOME labels say *which* places were homes, but they are too
// sparse and inconsistent to say *when* (whole months go unlabelled, and a
// family home you stay at over Christmas gets labelled INFERRED_HOME too). So
// the labels only nominate candidate homes; the timeline comes from where
// you actually slept each night:
//
//   1. Cluster the labelled visits into candidate homes (HOME_RADIUS_KM).
//   2. Label each month with the candidate you slept at most that month
//      (strict plurality; months without such nights, or tied, stay unlabelled).
//   3. Consecutive months with the same label form segments. Repeatedly drop
//      the weakest segment whose support (months) is below the minimum; when
//      a dropped segment sat between two segments of the same home they merge,
//      and the merged support is net of the dropped months. Christmas at your
//      parents' or a three-month stint abroad thus stays a trip, and patchy
//      early data that alternates between two places can't add up to a home.
//   4. Turn the surviving segments into dated periods: a period ends on the
//      last night slept at its home up to the next home's first month, and the
//      next starts on the first night at the new home after that. The first
//      period starts on the first night at its home; the last is ongoing.
//
// Nights outside every period (before the first one, or in the gap between
// two periods) belong to the nearest period in time, ties going to the
// earlier one (see periodIndexForDate).

/** Within this distance of a home you are at home; also the clustering radius. */
const HOME_RADIUS_KM = 1;

/** A HOME / INFERRED_HOME visit */
interface HomeSample {
  lat: number;
  lng: number;
  /** Raw "lat°, lng°" string, used to group identical coordinates */
  latLng: string;
  /** Local start date */
  date: string;
}

/** A candidate home: labelled visits within HOME_RADIUS_KM of each other. */
interface HomeCluster {
  /** Median of the member samples */
  lat: number;
  lng: number;
  samples: HomeSample[];
  /** Coordinate of the most common member sample (always a real visit spot) */
  seedLat: number;
  seedLng: number;
}

/**
 * Leader clustering, most-labelled coordinate first: each coordinate joins the
 * nearest cluster seed within radiusKm, else seeds a new cluster. Distance-
 * based on purpose; a fixed grid (like the city DB's 0.1° buckets) can split
 * one home in two when it sits on a bucket edge.
 */
function clusterHomeSamples(samples: HomeSample[], radiusKm: number): HomeCluster[] {
  const byCoord = new Map<string, HomeSample[]>();
  for (const s of samples) {
    const group = byCoord.get(s.latLng);
    if (group) group.push(s);
    else byCoord.set(s.latLng, [s]);
  }
  const groups = [...byCoord.values()].sort(
    (a, b) => b.length - a.length || a[0].latLng.localeCompare(b[0].latLng),
  );

  const seeds: { lat: number; lng: number; samples: HomeSample[] }[] = [];
  for (const group of groups) {
    const { lat, lng } = group[0];
    let nearest: (typeof seeds)[number] | null = null;
    let nearestDist = Infinity;
    for (const seed of seeds) {
      const d = haversineDist(seed.lat, seed.lng, lat, lng);
      if (d <= radiusKm && d < nearestDist) {
        nearest = seed;
        nearestDist = d;
      }
    }
    if (nearest) nearest.samples.push(...group);
    else seeds.push({ lat, lng, samples: [...group] });
  }

  return seeds.map((seed) => ({
    lat: median(seed.samples.map((s) => s.lat)),
    lng: median(seed.samples.map((s) => s.lng)),
    samples: seed.samples,
    seedLat: seed.lat,
    seedLng: seed.lng,
  }));
}

/** Where a night was spent: the visit overlapping the night window most, if any. */
interface NightLocation {
  date: string;
  lat: number | null;
  lng: number | null;
}

interface DetectedHomePeriod {
  /** Index into the clusters */
  cluster: number;
  /** First night at this home (night key) */
  start: string;
  /** Last night at this home; null for the latest (ongoing) period */
  end: string | null;
  /** Months this home was where you slept most, net of other homes' months inside the period */
  supportMonths: number;
}

function detectHomePeriods(
  nights: NightLocation[],
  clusters: HomeCluster[],
  minMonths: number,
): DetectedHomePeriod[] {
  // Which candidate home (if any) each night was spent at
  const nightHome = nights.map((n) => {
    if (n.lat === null || n.lng === null) return -1;
    let best = -1;
    let bestDist = Infinity;
    clusters.forEach((c, i) => {
      const d = haversineDist(c.lat, c.lng, n.lat!, n.lng!);
      if (d < HOME_RADIUS_KM && d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  });

  // Label each month with the home slept at most (nights are in date order)
  const months: string[] = [];
  const counts: Map<number, number>[] = [];
  nights.forEach((n, i) => {
    const month = n.date.slice(0, 7);
    if (months.at(-1) !== month) {
      months.push(month);
      counts.push(new Map());
    }
    const home = nightHome[i];
    if (home !== -1) counts[counts.length - 1].set(home, (counts[counts.length - 1].get(home) ?? 0) + 1);
  });
  const labels = counts.map((c) => {
    let best = -1;
    let bestCount = 0;
    let tied = false;
    for (const [home, count] of c) {
      if (count > bestCount) {
        best = home;
        bestCount = count;
        tied = false;
      } else if (count === bestCount) {
        tied = true;
      }
    }
    return tied ? -1 : best;
  });

  // Segments of consecutive labelled months (unlabelled months don't break them)
  interface Segment { cluster: number; support: number; firstMonth: number }
  const segments: Segment[] = [];
  labels.forEach((home, m) => {
    if (home === -1) return;
    const last = segments.at(-1);
    if (last?.cluster === home) last.support++;
    else segments.push({ cluster: home, support: 1, firstMonth: m });
  });

  // Drop the weakest short segment until every segment is long enough (or
  // only one is left); a drop between two segments of the same home merges them
  while (segments.length > 1) {
    let weakest = -1;
    segments.forEach((s, i) => {
      if (s.support < minMonths && (weakest === -1 || s.support < segments[weakest].support)) {
        weakest = i;
      }
    });
    if (weakest === -1) break;
    const prev = segments[weakest - 1];
    const next = segments[weakest + 1];
    if (prev && next && prev.cluster === next.cluster) {
      prev.support += next.support - segments[weakest].support;
      segments.splice(weakest, 2);
    } else {
      segments.splice(weakest, 1);
    }
  }

  // Dated periods
  const periods: DetectedHomePeriod[] = [];
  segments.forEach((seg, k) => {
    const prevEnd = periods.at(-1)?.end ?? '';
    const startIdx = nights.findIndex((n, i) => n.date > prevEnd && nightHome[i] === seg.cluster);
    const start = startIdx === -1 ? nights[0].date : nights[startIdx].date;
    let end: string | null = null;
    const next = segments[k + 1];
    if (next) {
      // Moving mid-month is common, so the new home's first month still counts
      const lastMonth = months[next.firstMonth];
      for (let i = 0; i < nights.length && nights[i].date.slice(0, 7) <= lastMonth; i++) {
        if (nightHome[i] === seg.cluster) end = nights[i].date;
      }
      if (end === null || end < start) end = start;
    }
    periods.push({ cluster: seg.cluster, start, end, supportMonths: seg.support });
  });
  return periods;
}

/**
 * Index of the period whose home applies to a night: the period containing
 * it, else the nearest one in time (before the first period → the first; in
 * a gap between two periods → the closer one, ties to the earlier).
 */
function periodIndexForDate(periods: { start: string; end: string | null }[], date: string): number {
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (date < p.start) {
      if (i === 0) return 0;
      const prevEnd = periods[i - 1].end!;
      const day = dayNumber(date);
      return day - dayNumber(prevEnd) <= dayNumber(p.start) - day ? i - 1 : i;
    }
    if (p.end === null || date <= p.end) return i;
  }
  return periods.length - 1;
}

// ---------------------------------------------------------------------------
// Embedded city database for reverse-geocoding flight endpoints
// ---------------------------------------------------------------------------
interface CityEntry { lat: number; lng: number; name: string; country: string }

interface ResolvedCity extends CityEntry {
  key: string;
  source: 'seed' | 'online' | 'fallback';
  updatedAt: string;
}

interface OfflineCityDbFile {
  version: number;
  updatedAt: string;
  entries: ResolvedCity[];
}

const CITIES: CityEntry[] = [
  // Europe
  { lat: 51.5074, lng: -0.1278, name: 'London', country: 'UK' },
  { lat: 48.8566, lng: 2.3522, name: 'Paris', country: 'France' },
  { lat: 52.5200, lng: 13.4050, name: 'Berlin', country: 'Germany' },
  { lat: 40.4168, lng: -3.7038, name: 'Madrid', country: 'Spain' },
  { lat: 41.3874, lng: 2.1686, name: 'Barcelona', country: 'Spain' },
  { lat: 41.9028, lng: 12.4964, name: 'Rome', country: 'Italy' },
  { lat: 45.4642, lng: 9.1900, name: 'Milan', country: 'Italy' },
  { lat: 52.3676, lng: 4.9041, name: 'Amsterdam', country: 'Netherlands' },
  { lat: 50.8503, lng: 4.3517, name: 'Brussels', country: 'Belgium' },
  { lat: 47.3769, lng: 8.5417, name: 'Zurich', country: 'Switzerland' },
  { lat: 46.2044, lng: 6.1432, name: 'Geneva', country: 'Switzerland' },
  { lat: 48.2082, lng: 16.3738, name: 'Vienna', country: 'Austria' },
  { lat: 50.0755, lng: 14.4378, name: 'Prague', country: 'Czech Republic' },
  { lat: 47.4979, lng: 19.0402, name: 'Budapest', country: 'Hungary' },
  { lat: 52.2297, lng: 21.0122, name: 'Warsaw', country: 'Poland' },
  { lat: 59.3293, lng: 18.0686, name: 'Stockholm', country: 'Sweden' },
  { lat: 60.1699, lng: 24.9384, name: 'Helsinki', country: 'Finland' },
  { lat: 59.9139, lng: 10.7522, name: 'Oslo', country: 'Norway' },
  { lat: 55.6761, lng: 12.5683, name: 'Copenhagen', country: 'Denmark' },
  { lat: 38.7223, lng: -9.1393, name: 'Lisbon', country: 'Portugal' },
  { lat: 37.9838, lng: 23.7275, name: 'Athens', country: 'Greece' },
  { lat: 53.3498, lng: -6.2603, name: 'Dublin', country: 'Ireland' },
  { lat: 55.9533, lng: -3.1883, name: 'Edinburgh', country: 'UK' },
  { lat: 53.4808, lng: -2.2426, name: 'Manchester', country: 'UK' },
  { lat: 45.4408, lng: 12.3155, name: 'Venice', country: 'Italy' },
  { lat: 43.7696, lng: 11.2558, name: 'Florence', country: 'Italy' },
  { lat: 40.8518, lng: 14.2681, name: 'Naples', country: 'Italy' },
  { lat: 43.2965, lng: 5.3698, name: 'Marseille', country: 'France' },
  { lat: 43.6047, lng: 1.4442, name: 'Toulouse', country: 'France' },
  { lat: 45.7640, lng: 4.8357, name: 'Lyon', country: 'France' },
  { lat: 53.5511, lng: 9.9937, name: 'Hamburg', country: 'Germany' },
  { lat: 48.1351, lng: 11.5820, name: 'Munich', country: 'Germany' },
  { lat: 50.9375, lng: 6.9603, name: 'Cologne', country: 'Germany' },
  { lat: 50.1109, lng: 8.6821, name: 'Frankfurt', country: 'Germany' },
  { lat: 44.4268, lng: 26.1025, name: 'Bucharest', country: 'Romania' },
  { lat: 42.6977, lng: 23.3219, name: 'Sofia', country: 'Bulgaria' },
  { lat: 44.7866, lng: 20.4489, name: 'Belgrade', country: 'Serbia' },
  { lat: 45.8150, lng: 15.9819, name: 'Zagreb', country: 'Croatia' },
  { lat: 43.8563, lng: 18.4131, name: 'Sarajevo', country: 'Bosnia' },
  { lat: 46.0569, lng: 14.5058, name: 'Ljubljana', country: 'Slovenia' },
  { lat: 64.1466, lng: -21.9426, name: 'Reykjavik', country: 'Iceland' },
  { lat: 36.7213, lng: -4.4214, name: 'Malaga', country: 'Spain' },
  { lat: 39.4699, lng: -0.3763, name: 'Valencia', country: 'Spain' },
  { lat: 37.3891, lng: -5.9845, name: 'Seville', country: 'Spain' },
  { lat: 28.1235, lng: -15.4363, name: 'Gran Canaria', country: 'Spain' },
  { lat: 28.4636, lng: -16.2518, name: 'Tenerife', country: 'Spain' },
  { lat: 39.6131, lng: 2.8882, name: 'Palma de Mallorca', country: 'Spain' },
  { lat: 43.2630, lng: -2.9350, name: 'Bilbao', country: 'Spain' },
  // Americas
  { lat: 40.7128, lng: -74.0060, name: 'New York', country: 'USA' },
  { lat: 34.0522, lng: -118.2437, name: 'Los Angeles', country: 'USA' },
  { lat: 41.8781, lng: -87.6298, name: 'Chicago', country: 'USA' },
  { lat: 37.7749, lng: -122.4194, name: 'San Francisco', country: 'USA' },
  { lat: 25.7617, lng: -80.1918, name: 'Miami', country: 'USA' },
  { lat: 33.4484, lng: -112.0740, name: 'Phoenix', country: 'USA' },
  { lat: 47.6062, lng: -122.3321, name: 'Seattle', country: 'USA' },
  { lat: 38.9072, lng: -77.0369, name: 'Washington DC', country: 'USA' },
  { lat: 42.3601, lng: -71.0589, name: 'Boston', country: 'USA' },
  { lat: 29.7604, lng: -95.3698, name: 'Houston', country: 'USA' },
  { lat: 32.7767, lng: -96.7970, name: 'Dallas', country: 'USA' },
  { lat: 36.1699, lng: -115.1398, name: 'Las Vegas', country: 'USA' },
  { lat: 33.7490, lng: -84.3880, name: 'Atlanta', country: 'USA' },
  { lat: 43.6532, lng: -79.3832, name: 'Toronto', country: 'Canada' },
  { lat: 45.5017, lng: -73.5673, name: 'Montreal', country: 'Canada' },
  { lat: 49.2827, lng: -123.1207, name: 'Vancouver', country: 'Canada' },
  { lat: 19.4326, lng: -99.1332, name: 'Mexico City', country: 'Mexico' },
  { lat: 21.1619, lng: -86.8515, name: 'Cancun', country: 'Mexico' },
  { lat: -23.5505, lng: -46.6333, name: 'São Paulo', country: 'Brazil' },
  { lat: -22.9068, lng: -43.1729, name: 'Rio de Janeiro', country: 'Brazil' },
  { lat: -34.6037, lng: -58.3816, name: 'Buenos Aires', country: 'Argentina' },
  { lat: -33.4489, lng: -70.6693, name: 'Santiago', country: 'Chile' },
  { lat: 4.7110, lng: -74.0721, name: 'Bogota', country: 'Colombia' },
  { lat: -12.0464, lng: -77.0428, name: 'Lima', country: 'Peru' },
  { lat: 10.4806, lng: -66.9036, name: 'Caracas', country: 'Venezuela' },
  { lat: 18.4655, lng: -66.1057, name: 'San Juan', country: 'Puerto Rico' },
  { lat: 9.9281, lng: -84.0907, name: 'San Jose', country: 'Costa Rica' },
  // Middle East
  { lat: 25.2048, lng: 55.2708, name: 'Dubai', country: 'UAE' },
  { lat: 24.4539, lng: 54.3773, name: 'Abu Dhabi', country: 'UAE' },
  { lat: 26.2285, lng: 50.5860, name: 'Manama', country: 'Bahrain' },
  { lat: 25.2854, lng: 51.5310, name: 'Doha', country: 'Qatar' },
  { lat: 41.0082, lng: 28.9784, name: 'Istanbul', country: 'Turkey' },
  { lat: 39.9334, lng: 32.8597, name: 'Ankara', country: 'Turkey' },
  { lat: 36.8969, lng: 30.7133, name: 'Antalya', country: 'Turkey' },
  { lat: 32.0853, lng: 34.7818, name: 'Tel Aviv', country: 'Israel' },
  { lat: 31.7683, lng: 35.2137, name: 'Jerusalem', country: 'Israel' },
  { lat: 30.0444, lng: 31.2357, name: 'Cairo', country: 'Egypt' },
  { lat: 33.8938, lng: 35.5018, name: 'Beirut', country: 'Lebanon' },
  { lat: 31.9454, lng: 35.9284, name: 'Amman', country: 'Jordan' },
  // Asia
  { lat: 35.6762, lng: 139.6503, name: 'Tokyo', country: 'Japan' },
  { lat: 34.6937, lng: 135.5023, name: 'Osaka', country: 'Japan' },
  { lat: 37.5665, lng: 126.9780, name: 'Seoul', country: 'South Korea' },
  { lat: 39.9042, lng: 116.4074, name: 'Beijing', country: 'China' },
  { lat: 31.2304, lng: 121.4737, name: 'Shanghai', country: 'China' },
  { lat: 22.3193, lng: 114.1694, name: 'Hong Kong', country: 'China' },
  { lat: 1.3521, lng: 103.8198, name: 'Singapore', country: 'Singapore' },
  { lat: 13.7563, lng: 100.5018, name: 'Bangkok', country: 'Thailand' },
  { lat: 3.1390, lng: 101.6869, name: 'Kuala Lumpur', country: 'Malaysia' },
  { lat: -6.2088, lng: 106.8456, name: 'Jakarta', country: 'Indonesia' },
  { lat: -8.3405, lng: 115.0920, name: 'Bali', country: 'Indonesia' },
  { lat: 14.5995, lng: 120.9842, name: 'Manila', country: 'Philippines' },
  { lat: 21.0278, lng: 105.8342, name: 'Hanoi', country: 'Vietnam' },
  { lat: 10.8231, lng: 106.6297, name: 'Ho Chi Minh City', country: 'Vietnam' },
  { lat: 28.6139, lng: 77.2090, name: 'New Delhi', country: 'India' },
  { lat: 19.0760, lng: 72.8777, name: 'Mumbai', country: 'India' },
  { lat: 12.9716, lng: 77.5946, name: 'Bangalore', country: 'India' },
  { lat: 22.5726, lng: 88.3639, name: 'Kolkata', country: 'India' },
  { lat: 27.7172, lng: 85.3240, name: 'Kathmandu', country: 'Nepal' },
  { lat: 23.8103, lng: 90.4125, name: 'Dhaka', country: 'Bangladesh' },
  // Africa
  { lat: -33.9249, lng: 18.4241, name: 'Cape Town', country: 'South Africa' },
  { lat: -26.2041, lng: 28.0473, name: 'Johannesburg', country: 'South Africa' },
  { lat: -1.2921, lng: 36.8219, name: 'Nairobi', country: 'Kenya' },
  { lat: 6.5244, lng: 3.3792, name: 'Lagos', country: 'Nigeria' },
  { lat: 33.5731, lng: -7.5898, name: 'Casablanca', country: 'Morocco' },
  { lat: 31.6295, lng: -7.9811, name: 'Marrakech', country: 'Morocco' },
  { lat: 36.8065, lng: 10.1815, name: 'Tunis', country: 'Tunisia' },
  { lat: 9.0250, lng: 38.7469, name: 'Addis Ababa', country: 'Ethiopia' },
  { lat: 14.7167, lng: -17.4677, name: 'Dakar', country: 'Senegal' },
  // Oceania
  { lat: -33.8688, lng: 151.2093, name: 'Sydney', country: 'Australia' },
  { lat: -37.8136, lng: 144.9631, name: 'Melbourne', country: 'Australia' },
  { lat: -27.4698, lng: 153.0251, name: 'Brisbane', country: 'Australia' },
  { lat: -31.9505, lng: 115.8605, name: 'Perth', country: 'Australia' },
  { lat: -36.8485, lng: 174.7633, name: 'Auckland', country: 'New Zealand' },
  { lat: -41.2865, lng: 174.7762, name: 'Wellington', country: 'New Zealand' },
  // Russia / Central Asia
  { lat: 55.7558, lng: 37.6173, name: 'Moscow', country: 'Russia' },
  { lat: 59.9343, lng: 30.3351, name: 'St Petersburg', country: 'Russia' },
  // Caribbean
  { lat: 25.0343, lng: -77.3963, name: 'Nassau', country: 'Bahamas' },
  { lat: 18.9712, lng: -72.2852, name: 'Port-au-Prince', country: 'Haiti' },
  { lat: 18.4861, lng: -69.9312, name: 'Santo Domingo', country: 'Dominican Republic' },
  { lat: 23.1136, lng: -82.3666, name: 'Havana', country: 'Cuba' },
  { lat: 18.1096, lng: -77.2975, name: 'Kingston', country: 'Jamaica' },
];

function roundToBucket(value: number, bucketDeg: number): number {
  return Math.round(value / bucketDeg) * bucketDeg;
}

function coordKey(lat: number, lng: number, bucketDeg: number): string {
  return `${roundToBucket(lat, bucketDeg).toFixed(3)},${roundToBucket(lng, bucketDeg).toFixed(3)}`;
}

function findNearestCityFromList(lat: number, lng: number, cities: CityEntry[]): CityEntry | null {
  let best: CityEntry | null = null;
  let bestDist = Infinity;
  for (const c of cities) {
    const d = haversineDist(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function readOfflineCityDb(
  dbPath: string,
  bucketDeg: number,
): Map<string, ResolvedCity> {
  const map = new Map<string, ResolvedCity>();
  for (const seed of CITIES) {
    const key = coordKey(seed.lat, seed.lng, bucketDeg);
    map.set(key, {
      ...seed,
      key,
      source: 'seed',
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  }

  if (!fs.existsSync(dbPath)) return map;

  try {
    const raw = fs.readFileSync(dbPath, 'utf-8');
    const parsed = JSON.parse(raw) as OfflineCityDbFile;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const e of entries) {
      if (
        typeof e?.lat === 'number' &&
        typeof e?.lng === 'number' &&
        typeof e?.name === 'string' &&
        typeof e?.country === 'string'
      ) {
        const key = e.key || coordKey(e.lat, e.lng, bucketDeg);
        map.set(key, {
          key,
          lat: e.lat,
          lng: e.lng,
          name: e.name,
          country: e.country,
          source:
            e.source === 'online' || e.source === 'fallback' || e.source === 'seed'
              ? e.source
              : 'fallback',
          updatedAt:
            typeof e.updatedAt === 'string'
              ? e.updatedAt
              : new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn('Could not parse offline city DB, continuing with seed cities only.', err);
  }

  return map;
}

function writeOfflineCityDb(dbPath: string, map: Map<string, ResolvedCity>) {
  const entries = [...map.values()].sort(
    (a, b) =>
      a.country.localeCompare(b.country) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
  const payload: OfflineCityDbFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  };
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(payload, null, 2));
}

async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
  timeoutMs: number,
  userAgent: string,
): Promise<{ name: string; country: string } | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lng)}&zoom=10&addressdetails=1&accept-language=en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      address?: Record<string, string>;
    };
    const address = payload.address ?? {};
    const name =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      address.state_district ||
      address.state;
    const country = address.country;
    if (!name || !country) return null;
    return { name, country };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

class CityResolver {
  private readonly cityDb: Map<string, ResolvedCity>;
  private readonly bucketDeg: number;
  private readonly onlineEnabled: boolean;
  private readonly maxOnlineLookups: number;
  private readonly onlineTimeoutMs: number;
  private readonly minRequestGapMs: number;
  private readonly userAgent: string;
  private readonly refreshFallbackEntries: boolean;
  private lastOnlineRequestMs = 0;
  private onlineLookupsUsed = 0;

  public cacheHits = 0;
  public onlineHits = 0;
  public fallbackHits = 0;

  constructor(options: {
    cityDb: Map<string, ResolvedCity>;
    bucketDeg: number;
    onlineEnabled: boolean;
    maxOnlineLookups: number;
    onlineTimeoutMs: number;
    requestsPerSecond: number;
    userAgent: string;
    refreshFallbackEntries: boolean;
  }) {
    this.cityDb = options.cityDb;
    this.bucketDeg = options.bucketDeg;
    this.onlineEnabled = options.onlineEnabled;
    this.maxOnlineLookups = options.maxOnlineLookups;
    this.onlineTimeoutMs = options.onlineTimeoutMs;
    this.minRequestGapMs = Math.max(0, Math.floor(1000 / options.requestsPerSecond));
    this.userAgent = options.userAgent;
    this.refreshFallbackEntries = options.refreshFallbackEntries;
  }

  private async throttleOnlineRequests() {
    const now = Date.now();
    const elapsed = now - this.lastOnlineRequestMs;
    if (elapsed < this.minRequestGapMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minRequestGapMs - elapsed));
    }
    this.lastOnlineRequestMs = Date.now();
  }

  private getNearestFallback(lat: number, lng: number): CityEntry | null {
    return findNearestCityFromList(lat, lng, [...this.cityDb.values()]);
  }

  async resolve(lat: number, lng: number): Promise<ResolvedCity | null> {
    const key = coordKey(lat, lng, this.bucketDeg);
    const existing = this.cityDb.get(key);
    const shouldRefreshFallback =
      existing?.source === 'fallback' &&
      this.onlineEnabled &&
      this.refreshFallbackEntries &&
      this.onlineLookupsUsed < this.maxOnlineLookups;

    if (existing && !shouldRefreshFallback) {
      this.cacheHits++;
      return existing;
    }

    if (this.onlineEnabled && this.onlineLookupsUsed < this.maxOnlineLookups) {
      await this.throttleOnlineRequests();
      this.onlineLookupsUsed++;
      const online = await reverseGeocodeNominatim(
        lat,
        lng,
        this.onlineTimeoutMs,
        this.userAgent,
      );
      if (online) {
        const entry: ResolvedCity = {
          key,
          lat: roundToBucket(lat, this.bucketDeg),
          lng: roundToBucket(lng, this.bucketDeg),
          name: online.name,
          country: online.country,
          source: 'online',
          updatedAt: new Date().toISOString(),
        };
        this.cityDb.set(key, entry);
        this.onlineHits++;
        return entry;
      }
    }

    const nearest = this.getNearestFallback(lat, lng);
    if (!nearest) return null;
    const fallback: ResolvedCity = {
      key,
      lat: roundToBucket(lat, this.bucketDeg),
      lng: roundToBucket(lng, this.bucketDeg),
      name: nearest.name,
      country: nearest.country,
      source: 'fallback',
      updatedAt: new Date().toISOString(),
    };
    this.cityDb.set(key, fallback);
    this.fallbackHits++;
    return fallback;
  }

  async prefill(coords: { lat: number; lng: number }[]) {
    const uniqueByKey = new Map<string, { lat: number; lng: number }>();
    for (const c of coords) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      const key = coordKey(c.lat, c.lng, this.bucketDeg);
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, c);
    }

    const unique = [...uniqueByKey.values()];
    for (let i = 0; i < unique.length; i++) {
      const c = unique[i];
      await this.resolve(c.lat, c.lng);
      if ((i + 1) % 200 === 0 || i + 1 === unique.length) {
        console.log(`  City DB prefill: ${i + 1}/${unique.length}`);
      }
    }
  }

  /** Cached entry for a coordinate's bucket, without any lookup or refresh. */
  peek(lat: number, lng: number): ResolvedCity | undefined {
    return this.cityDb.get(coordKey(lat, lng, this.bucketDeg));
  }

  getDb(): Map<string, ResolvedCity> {
    return this.cityDb;
  }

  getStats() {
    return {
      totalEntries: this.cityDb.size,
      cacheHits: this.cacheHits,
      onlineHits: this.onlineHits,
      fallbackHits: this.fallbackHits,
      onlineLookupsUsed: this.onlineLookupsUsed,
    };
  }
}

// ---------------------------------------------------------------------------
// Country matching: geocoder country names → ISO 3166-1 alpha-3 codes, via the
// name fields of the vendored world geometry the frontend map draws
// (public/world-countries.geo.json), so every emitted code has a shape.
// ---------------------------------------------------------------------------
interface WorldCountryFeature {
  properties: { iso3: string; name: string; names?: string[] };
}

interface CountryMatch {
  iso3: string;
  name: string;
}

/**
 * Country names used by the seed city list or returned by Nominatim that
 * don't appear in Natural Earth's name fields, mapped to a name that does.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  USA: 'United States',
  US: 'United States',
  UK: 'United Kingdom',
  'Great Britain': 'United Kingdom',
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
  UAE: 'United Arab Emirates',
  Bosnia: 'Bosnia and Herzegovina',
  Türkiye: 'Turkey',
  'Palestinian Territories': 'Palestine',
  'Palestinian Territory': 'Palestine',
  'State of Palestine': 'Palestine',
  'Congo-Kinshasa': 'Democratic Republic of the Congo',
  'Congo-Brazzaville': 'Republic of the Congo',
  Swaziland: 'Eswatini',
  Burma: 'Myanmar',
  Macedonia: 'North Macedonia',
  'Holy See': 'Vatican City',
};

/** "Côte d'Ivoire" → "cote d ivoire", "The Bahamas" → "bahamas" */
function normalizeCountryName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Normalized country name → ISO code + display name, from the world geometry. */
function loadCountryIndex(geoPath: string): Map<string, CountryMatch> {
  const index = new Map<string, CountryMatch>();
  if (!fs.existsSync(geoPath)) {
    console.warn(`  World geometry not found at ${geoPath}; countries get no ISO codes.`);
    return index;
  }
  const { features } = JSON.parse(fs.readFileSync(geoPath, 'utf-8')) as {
    features: WorldCountryFeature[];
  };
  const nameLists = features.map((f) => [f.properties.name, ...(f.properties.names ?? [])]);
  // Register rank by rank so a country's primary name always wins over
  // another country's alternate name.
  const maxRank = Math.max(0, ...nameLists.map((l) => l.length));
  for (let rank = 0; rank < maxRank; rank++) {
    features.forEach((f, i) => {
      const name = nameLists[i][rank];
      const key = name ? normalizeCountryName(name) : '';
      if (key && !index.has(key)) {
        index.set(key, { iso3: f.properties.iso3, name: f.properties.name });
      }
    });
  }
  for (const [alias, target] of Object.entries(COUNTRY_ALIASES)) {
    const match = index.get(normalizeCountryName(target));
    const key = normalizeCountryName(alias);
    if (match && !index.has(key)) index.set(key, match);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const ROOT = path.resolve('.');
  const RAW = path.join(ROOT, 'Timeline.json');
  const OUT = path.join(ROOT, 'public', 'data');
  const CITY_DB_PATH = path.join(ROOT, 'scripts', 'data', 'offline-city-db.json');
  const WORLD_GEO_PATH = path.join(ROOT, 'public', 'world-countries.geo.json');
  const AIRPORTS_PATH = path.join(ROOT, 'scripts', 'data', 'airports.json');

  const CITY_BUCKET_DEG = Number(ENV.CITY_DB_BUCKET_DEG ?? '0.1');
  const CITY_ONLINE_ENABLED = (ENV.CITY_DB_ENABLE_ONLINE ?? '1') !== '0';
  const CITY_MAX_ONLINE = Number(ENV.CITY_DB_MAX_ONLINE_LOOKUPS ?? '80');
  const CITY_TIMEOUT_MS = Number(ENV.CITY_DB_ONLINE_TIMEOUT_MS ?? '4000');
  // Nominatim usage policy allows at most 1 request per second
  const CITY_RPS = Number(ENV.CITY_DB_ONLINE_RPS ?? '1');
  const CITY_REFRESH_FALLBACK =
    (ENV.CITY_DB_REFRESH_FALLBACK ?? '1') !== '0';
  const CITY_USER_AGENT =
    ENV.CITY_DB_USER_AGENT ??
    'timeline-visualizer/1.0 (offline-db-auto-update)';
  // A home must be where you slept most for this many months (net, see
  // detectHomePeriods) — longer than a summer at family or a research stint
  // abroad, short enough that a move shows up within half a year.
  const envMinMonths = parseInt(ENV.HOME_MIN_PERIOD_MONTHS ?? '', 10);
  const HOME_MIN_PERIOD_MONTHS = envMinMonths >= 1 ? envMinMonths : 5;

  fs.mkdirSync(OUT, { recursive: true });

  console.log('Reading Timeline.json…');
  const raw: RawTimeline = JSON.parse(fs.readFileSync(RAW, 'utf-8'));
  const segments = raw.semanticSegments;
  console.log(`  ${segments.length} segments loaded`);

  // ========================================================================
  // 1. Collect home samples (home periods are detected with the nights, §4)
  // ========================================================================
  const homeSamples: HomeSample[] = [];
  for (const s of segments) {
    const st = s.visit?.topCandidate?.semanticType;
    const latLng = s.visit?.topCandidate?.placeLocation?.latLng;
    if ((st === 'INFERRED_HOME' || st === 'HOME') && latLng) {
      const [lat, lng] = parseLatLng(latLng);
      homeSamples.push({ lat, lng, latLng, date: dateStr(localStart(s)) });
    }
  }
  console.log(`  ${homeSamples.length} HOME / INFERRED_HOME visits`);

  // ========================================================================
  // 2. Extract visits
  // ========================================================================
  console.log('Extracting visits…');
  interface Visit {
    placeId: string;
    lat: number;
    lng: number;
    semanticType: string;
    /** Local timestamps (mixed UTC offsets, so sort by instant, not as strings) */
    arrivals: string[];
    departures: string[];
    totalMinutes: number;
    visitCount: number;
    /** [local start date, duration in seconds] for every stay */
    stays: [string, number][];
  }
  const visitMap = new Map<string, Visit>();

  for (const s of segments) {
    if (!s.visit) continue;
    const tc = s.visit.topCandidate;
    if (!tc.placeId || !tc.placeLocation?.latLng) continue;
    const [lat, lng] = parseLatLng(tc.placeLocation.latLng);
    const key = tc.placeId;
    const dur = durationMin(s.startTime, s.endTime);
    const arrival = localStart(s);
    const stay: [string, number] = [dateStr(arrival), durationSec(s.startTime, s.endTime)];
    const existing = visitMap.get(key);
    if (existing) {
      existing.arrivals.push(arrival);
      existing.departures.push(localEnd(s));
      existing.totalMinutes += dur;
      existing.visitCount++;
      existing.stays.push(stay);
    } else {
      visitMap.set(key, {
        placeId: key,
        lat,
        lng,
        semanticType: tc.semanticType ?? 'UNKNOWN',
        arrivals: [arrival],
        departures: [localEnd(s)],
        totalMinutes: dur,
        visitCount: 1,
        stays: [stay],
      });
    }
  }

  // Flatten and sort by visit count descending
  const visitsBase = [...visitMap.values()]
    .map((v) => {
      const arrivals = [...v.arrivals].sort((a, b) => Date.parse(a) - Date.parse(b));
      return {
        placeId: v.placeId,
        lat: v.lat,
        lng: v.lng,
        semanticType: v.semanticType,
        visitCount: v.visitCount,
        totalHours: Math.round(v.totalMinutes / 6) / 10,
        firstVisit: arrivals[0],
        lastVisit: arrivals.at(-1),
        stays: v.stays,
      };
    })
    .sort((a, b) => b.visitCount - a.visitCount);

  console.log(`  ${visitsBase.length} unique places`);

  console.log('Loading offline city database…');
  const cityDb = readOfflineCityDb(CITY_DB_PATH, CITY_BUCKET_DEG);
  const cityResolver = new CityResolver({
    cityDb,
    bucketDeg: CITY_BUCKET_DEG,
    onlineEnabled: CITY_ONLINE_ENABLED,
    maxOnlineLookups: CITY_MAX_ONLINE,
    onlineTimeoutMs: CITY_TIMEOUT_MS,
    requestsPerSecond: CITY_RPS,
    userAgent: CITY_USER_AGENT,
    refreshFallbackEntries: CITY_REFRESH_FALLBACK,
  });

  console.log('Prefilling offline city database from timeline locations…');
  await cityResolver.prefill(
    visitsBase.map((v) => ({ lat: v.lat, lng: v.lng })),
  );

  // The raw Timeline export carries no human-readable place name (only
  // placeId + coordinates), so resolve each visit's city/country via the
  // same offline city DB used elsewhere. The prefill step above already
  // populated the resolver's cache for every visit coordinate, so these
  // are cache hits — no additional online lookups are triggered here.
  console.log('Resolving place names for visits…');
  const visits: (typeof visitsBase[number] & {
    city?: string;
    country?: string;
  })[] = [];
  for (const v of visitsBase) {
    const resolved = await cityResolver.resolve(v.lat, v.lng);
    visits.push({
      ...v,
      city: resolved?.name,
      country: resolved?.country,
    });
  }

  fs.writeFileSync(path.join(OUT, 'visits.json'), JSON.stringify(visits));

  // ========================================================================
  // 3. Extract flights
  // ========================================================================
  console.log('Extracting flights…');
  const airports = loadAirports(AIRPORTS_PATH);
  console.log(`  ${airports.length} airports loaded for nearest-airport matching`);
  interface Flight {
    /** Local departure date */
    date: string;
    /** Local departure time, in the departure's UTC offset */
    startTime: string;
    /** Local arrival time, in the arrival's UTC offset */
    endTime: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    distanceKm: number;
    durationMin: number;
    path: [number, number][];
  }

  const flights: Flight[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.activity?.topCandidate?.type !== 'FLYING') continue;

    const [sLat, sLng] = parseLatLng(s.activity.start.latLng);
    const [eLat, eLng] = parseLatLng(s.activity.end.latLng);

    // Collect timelinePath from the preceding path segment if present
    const pathPoints: [number, number][] = [];
    if (i > 0 && segments[i - 1].timelinePath) {
      for (const p of segments[i - 1].timelinePath!) {
        pathPoints.push(parseLatLng(p.point));
      }
    }

    const departure = localStart(s);
    flights.push({
      date: dateStr(departure),
      startTime: departure,
      endTime: localEnd(s),
      startLat: sLat,
      startLng: sLng,
      endLat: eLat,
      endLng: eLng,
      distanceKm: Math.round(s.activity.distanceMeters / 100) / 10,
      durationMin: Math.round(durationMin(s.startTime, s.endTime)),
      path:
        pathPoints.length > 1
          ? pathPoints
          : [
              [sLat, sLng],
              [eLat, eLng],
            ],
    });
  }

  // Try to resolve origin/destination names from adjacent visits
  function findNearestVisit(
    idx: number,
    direction: -1 | 1,
  ): { placeId: string; lat: number; lng: number } | null {
    for (
      let j = idx + direction;
      j >= 0 && j < segments.length;
      j += direction
    ) {
      const seg = segments[j];
      if (seg.visit?.topCandidate?.placeLocation?.latLng) {
        const [lat, lng] = parseLatLng(
          seg.visit.topCandidate.placeLocation.latLng,
        );
        return {
          placeId: seg.visit.topCandidate.placeId ?? '',
          lat,
          lng,
        };
      }
      // Don't search too far
      if (Math.abs(j - idx) > 10) break;
    }
    return null;
  }

  // Enrich flights with origin/destination info + city names
  interface EnrichedFlight extends Flight {
    originPlaceId?: string;
    destPlaceId?: string;
    startCity?: string;
    startCountry?: string;
    endCity?: string;
    endCountry?: string;
    startAirport: MatchedAirport | null;
    endAirport: MatchedAirport | null;
    /** Estimated kg CO2e for this flight, see estimateFlightCo2Kg */
    co2Kg: number;
  }

  const enrichedFlights: EnrichedFlight[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.activity?.topCandidate?.type !== 'FLYING') continue;
    const fIdx = enrichedFlights.length;
    const flight = flights[fIdx];
    if (!flight) continue;

    const origin = findNearestVisit(i, -1);
    const dest = findNearestVisit(i, 1);

    const startCity = await cityResolver.resolve(flight.startLat, flight.startLng);
    const endCity = await cityResolver.resolve(flight.endLat, flight.endLng);

    const startAirport = findNearestAirport(flight.startLat, flight.startLng, airports);
    const endAirport = findNearestAirport(flight.endLat, flight.endLng, airports);
    const greatCircleKm = haversineDist(flight.startLat, flight.startLng, flight.endLat, flight.endLng);

    enrichedFlights.push({
      ...flight,
      originPlaceId: origin?.placeId,
      destPlaceId: dest?.placeId,
      startCity: startCity?.name,
      startCountry: startCity?.country,
      endCity: endCity?.name,
      endCountry: endCity?.country,
      startAirport,
      endAirport,
      co2Kg: estimateFlightCo2Kg(greatCircleKm),
    });
  }

  console.log(`  ${enrichedFlights.length} flights found`);

  const fullyMatched = enrichedFlights.filter((f) => f.startAirport && f.endAirport);
  const unmatchedFlights = enrichedFlights.filter((f) => !f.startAirport || !f.endAirport);
  console.log(
    `  Airport match: ${fullyMatched.length}/${enrichedFlights.length} flights matched at both ends ` +
      `(${Math.round((fullyMatched.length / (enrichedFlights.length || 1)) * 100)}%)`,
  );
  if (unmatchedFlights.length > 0) {
    console.log('  Unmatched flight endpoints:');
    for (const f of unmatchedFlights) {
      const endpoint = (airport: MatchedAirport | null, lat: number, lng: number) =>
        airport ? airport.iata : `no match (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
      console.log(
        `    ${f.date}: ${endpoint(f.startAirport, f.startLat, f.startLng)} → ` +
          `${endpoint(f.endAirport, f.endLat, f.endLng)}`,
      );
    }
  }
  const totalCo2Kg = enrichedFlights.reduce((sum, f) => sum + f.co2Kg, 0);
  console.log(`  Total estimated CO2 (all flights, all time): ${(totalCo2Kg / 1000).toFixed(1)} t`);

  fs.writeFileSync(
    path.join(OUT, 'flights.json'),
    JSON.stringify(enrichedFlights),
  );

  // ========================================================================
  // 4. Home periods and nights away from home
  // ========================================================================
  console.log('Locating nights…');
  // One night per local date the export covers, keyed by the date of the
  // evening it begins: night D is 20:00 on D to 08:00 on D+1, local time. It
  // was spent at the visit overlapping that window most, each visit judged in
  // its own local time (the UTC offset recorded at its start; a stay spanning
  // a DST change is off by that hour after it, which never moves a date). So
  // a night in San Francisco is the San Francisco evening's date and hours,
  // whatever zone the phone was set to. Home periods are detected from these,
  // then each night is checked against the home of its period
  // (>HOME_RADIUS_KM away = a night away).
  const NIGHT_BEFORE_MIDNIGHT_MS = 4 * 3_600_000;
  const NIGHT_AFTER_MIDNIGHT_MS = 8 * 3_600_000;
  // A "flight" longer than this is a gap-filling artifact (phone off), not a flight
  const MAX_FLIGHT_MS = 20 * 3_600_000;

  /** Epoch-ms interval plus the UTC offset (ms) of local time during it */
  interface LocalSpan {
    start: number;
    end: number;
    offsetMs: number;
  }

  /** Where a night was spent */
  interface NightPlace {
    lat: number;
    lng: number;
    placeId: string;
  }

  /** Epoch ms of the midnight ending `date`, in the local time of a UTC offset. */
  function localMidnight(date: string, offsetMs: number): number {
    return (dayNumber(date) + 1) * DAY_MS - offsetMs;
  }

  /** How long a span overlaps night `date`'s window, measured in the span's local time. */
  function nightOverlap(date: string, span: LocalSpan): number {
    const midnight = localMidnight(date, span.offsetMs);
    return (
      Math.min(span.end, midnight + NIGHT_AFTER_MIDNIGHT_MS) -
      Math.max(span.start, midnight - NIGHT_BEFORE_MIDNIGHT_MS)
    );
  }

  // Build a sorted list of visit segments with coordinates
  interface NightVisit extends LocalSpan, NightPlace {
    /** UTC offset (ms) where the visit ended */
    endOffsetMs: number;
    semanticType: string;
  }
  const visitSegments: NightVisit[] = [];
  for (const s of segments) {
    if (!s.visit?.topCandidate?.placeLocation?.latLng) continue;
    const [lat, lng] = parseLatLng(s.visit.topCandidate.placeLocation.latLng);
    visitSegments.push({
      start: Date.parse(s.startTime),
      end: Date.parse(s.endTime),
      offsetMs: startOffsetMinutes(s) * 60_000,
      endOffsetMs: endOffsetMinutes(s) * 60_000,
      lat,
      lng,
      placeId: s.visit.topCandidate.placeId ?? '',
      semanticType: s.visit.topCandidate.semanticType ?? 'UNKNOWN',
    });
  }
  visitSegments.sort((a, b) => a.start - b.start);

  // Nights on a plane: when no visit overlaps a night but you were in the air
  // at its midnight (in the departure's local time), the night was spent
  // flying away from where the flight left, and counts as spent there.
  // Without this an overnight flight home would count as a night at home.
  interface NightFlight extends LocalSpan {
    /** Departure point */
    origin: NightPlace;
  }
  const nightFlights: NightFlight[] = [];
  for (const s of segments) {
    if (s.activity?.topCandidate?.type !== 'FLYING') continue;
    const start = Date.parse(s.startTime);
    const end = Date.parse(s.endTime);
    if (end - start > MAX_FLIGHT_MS) continue;
    const [lat, lng] = parseLatLng(s.activity.start.latLng);
    nightFlights.push({ start, end, offsetMs: startOffsetMinutes(s) * 60_000, origin: { lat, lng, placeId: '' } });
  }

  const firstNight = dayNumber(dateStr(localStart(segments[0])));
  const lastNight = dayNumber(dateStr(localEnd(segments[segments.length - 1])));
  const nightVisits: { date: string; visit: NightPlace | null }[] = [];
  let visitIdx = 0;
  let flightIdx = 0;
  for (let day = firstNight; day <= lastNight; day++) {
    const date = dayString(day);
    // UTC offsets span −12…+14 h, so every local window of this night lies
    // within a day of the UTC midnight after `date`
    const windowsFrom = day * DAY_MS;
    const windowsUntil = (day + 2) * DAY_MS;

    while (visitIdx < visitSegments.length - 1 && visitSegments[visitIdx].end < windowsFrom) visitIdx++;
    let place: NightPlace | null = null;
    let bestOverlap = 0;
    for (let j = visitIdx; j < visitSegments.length && visitSegments[j].start < windowsUntil; j++) {
      const overlap = nightOverlap(date, visitSegments[j]);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        place = visitSegments[j];
      }
    }

    while (flightIdx < nightFlights.length - 1 && nightFlights[flightIdx].end < windowsFrom) flightIdx++;
    for (let j = flightIdx; !place && j < nightFlights.length && nightFlights[j].start < windowsUntil; j++) {
      const flight = nightFlights[j];
      const midnight = localMidnight(date, flight.offsetMs);
      if (flight.start <= midnight && midnight < flight.end) place = flight.origin;
    }

    nightVisits.push({ date, visit: place });
  }

  console.log('Detecting home periods…');
  // Geocoder names vary ("USA" vs "United States"), so countries are named
  // after the world geometry when they match (here and in geography.json)
  const countryIndex = loadCountryIndex(WORLD_GEO_PATH);

  interface HomePeriod {
    start: string;
    end: string | null;
    lat: number;
    lng: number;
    city: string | null;
    country: string | null;
  }

  const homeClusters = clusterHomeSamples(homeSamples, HOME_RADIUS_KM);
  const detected = detectHomePeriods(
    nightVisits.map(({ date, visit }) => ({ date, lat: visit?.lat ?? null, lng: visit?.lng ?? null })),
    homeClusters,
    HOME_MIN_PERIOD_MONTHS,
  );
  const homePeriods: HomePeriod[] = detected.map(({ cluster, start, end }) => {
    const c = homeClusters[cluster];
    // Cache hits only: the prefill covered every visit coordinate, and the
    // seed is one, should the median land in a bucket without visits
    const place = cityResolver.peek(c.lat, c.lng) ?? cityResolver.peek(c.seedLat, c.seedLng);
    return {
      start,
      end,
      lat: c.lat,
      lng: c.lng,
      city: place?.name ?? null,
      country: place ? (countryIndex.get(normalizeCountryName(place.country))?.name ?? place.country) : null,
    };
  });

  detected.forEach((d, i) => {
    const p = homePeriods[i];
    const inPeriod = (date: string) => date >= p.start && (p.end === null || date <= p.end);
    const samples = homeClusters[d.cluster].samples.filter((s) => inPeriod(s.date)).length;
    const nightsThere = nightVisits.filter(
      (n) => n.visit && inPeriod(n.date) && haversineDist(p.lat, p.lng, n.visit.lat, n.visit.lng) < HOME_RADIUS_KM,
    ).length;
    console.log(
      `  ${p.start} → ${p.end ?? 'ongoing'}: ${p.city ?? '?'}, ${p.country ?? '?'} ` +
        `(${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}) · ${d.supportMonths} months net, ` +
        `${nightsThere} nights there, ${samples} home-labelled visits`,
    );
  });
  if (homePeriods.length === 0) {
    console.warn('  No HOME / INFERRED_HOME visits found: every night counts as home.');
  }
  fs.writeFileSync(path.join(OUT, 'home.json'), JSON.stringify(homePeriods));

  interface NightEntry {
    date: string;
    isHome: boolean;
    lat?: number;
    lng?: number;
    /** Distance from the home of the period this night belongs to */
    distKm?: number;
    placeId?: string;
  }

  const nightsAway: NightEntry[] = nightVisits.map(({ date, visit }) => {
    // No visit data for this date (or no home at all) — unknown, treat as home
    if (!visit || homePeriods.length === 0) return { date, isHome: true };
    const home = homePeriods[periodIndexForDate(homePeriods, date)];
    const dist = haversineDist(home.lat, home.lng, visit.lat, visit.lng);
    return {
      date,
      isHome: dist < HOME_RADIUS_KM,
      lat: visit.lat,
      lng: visit.lng,
      distKm: Math.round(dist * 10) / 10,
      placeId: visit.placeId,
    };
  });

  const totalAway = nightsAway.filter((n) => !n.isHome).length;
  console.log(
    `  ${nightsAway.length} nights tracked, ${totalAway} away from home`,
  );
  fs.writeFileSync(
    path.join(OUT, 'nights-away.json'),
    JSON.stringify(nightsAway),
  );

  // ========================================================================
  // 5. Geography: countries, away-night cities, and days present
  // ========================================================================
  // Emitted per night and per date (not as totals) so the frontend can rank
  // countries and cities, and shade the world map, for any selected range.
  console.log('Resolving geography…');

  interface GeographyCountry {
    /** Display name: the world geometry's name when matched, else the raw name */
    country: string;
    /** ISO 3166-1 alpha-3 of the matching world-countries.geo.json feature; null if unmatched */
    iso3: string | null;
  }

  interface GeographyCity {
    city: string;
    /** Index into `countries` */
    country: number;
    lat: number;
    lng: number;
  }

  interface GeographyNight {
    date: string;
    /** Index into `cities`, or null when no city could be resolved */
    city: number | null;
  }

  // Countries are keyed by ISO code (countryIndex, loaded in §4) so name
  // variants merge, and named after the world geometry when they match.
  const geoCountries: GeographyCountry[] = [];
  const geoCountryIndex = new Map<string, number>();
  function countryId(rawName: string): number {
    const match = countryIndex.get(normalizeCountryName(rawName));
    const key = match ? match.iso3 : `?${rawName}`;
    let id = geoCountryIndex.get(key);
    if (id === undefined) {
      id = geoCountries.length;
      geoCountryIndex.set(key, id);
      geoCountries.push({ country: match?.name ?? rawName, iso3: match?.iso3 ?? null });
    }
    return id;
  }

  const geoCities: GeographyCity[] = [];
  const geoCityIndex = new Map<string, number>();
  const geoNights: GeographyNight[] = [];

  for (const night of nightsAway) {
    if (night.isHome) continue;

    const cityMatch =
      night.lat != null && night.lng != null
        ? await cityResolver.resolve(night.lat, night.lng)
        : null;
    let city: number | null = null;
    if (cityMatch) {
      const country = countryId(cityMatch.country);
      const cityKey = `${cityMatch.name}::${country}`;
      city = geoCityIndex.get(cityKey) ?? null;
      if (city === null) {
        city = geoCities.length;
        geoCityIndex.set(cityKey, city);
        geoCities.push({
          city: cityMatch.name,
          country,
          lat: cityMatch.lat,
          lng: cityMatch.lng,
        });
      }
    }
    geoNights.push({ date: night.date, city });
  }

  // Days present: every local date a visit was recorded in a country, from
  // the visit's local start date to its local end date. Unlike away nights
  // this includes home time, day trips and layovers; a travel day counts for
  // both countries. Visit coordinates are already in the city DB from the
  // prefill, so resolve() only runs for rare placeId-less visits.
  const countriesByDay = new Map<number, Set<number>>();
  for (const v of visitSegments) {
    const city = cityResolver.peek(v.lat, v.lng) ?? (await cityResolver.resolve(v.lat, v.lng));
    if (!city) continue;
    const country = countryId(city.country);
    const firstDay = Math.floor((v.start + v.offsetMs) / DAY_MS);
    const lastDay = Math.max(firstDay, Math.floor((v.end + v.endOffsetMs) / DAY_MS));
    for (let day = firstDay; day <= lastDay; day++) {
      let present = countriesByDay.get(day);
      if (!present) {
        present = new Set();
        countriesByDay.set(day, present);
      }
      present.add(country);
    }
  }
  const presence: [string, number[]][] = [...countriesByDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, present]) => [dayString(day), [...present].sort((a, b) => a - b)]);

  const unmappedCountries = geoCountries.filter((c) => !c.iso3).map((c) => c.country);
  if (unmappedCountries.length > 0) {
    console.warn(
      `  No map geometry for: ${unmappedCountries.join(', ')} (add them to COUNTRY_ALIASES)`,
    );
  }

  const geography = {
    countries: geoCountries,
    cities: geoCities,
    nights: geoNights,
    presence,
  };

  console.log(
    `  ${geoCountries.length} countries (${geoCountries.length - unmappedCountries.length} on the map), ` +
      `${geoCities.length} cities matched, ${presence.length} days with a known country`,
  );
  fs.writeFileSync(
    path.join(OUT, 'geography.json'),
    JSON.stringify(geography),
  );

  // ========================================================================
  // 6. Group into trips
  // ========================================================================
  console.log('Grouping trips…');
  interface Trip {
    startDate: string;
    endDate: string;
    nights: number;
    places: { placeId: string; lat: number; lng: number; nights: number }[];
    maxDistKm: number;
  }

  const trips: Trip[] = [];
  let tripStart = -1;
  for (let i = 0; i < nightsAway.length; i++) {
    if (!nightsAway[i].isHome) {
      if (tripStart === -1) tripStart = i;
    } else {
      if (tripStart !== -1) {
        // End of trip
        const tripNights = nightsAway.slice(tripStart, i);
        const placeCount = new Map<
          string,
          { lat: number; lng: number; nights: number }
        >();
        let maxDist = 0;
        for (const n of tripNights) {
          if (n.placeId) {
            const existing = placeCount.get(n.placeId);
            if (existing) {
              existing.nights++;
            } else {
              placeCount.set(n.placeId, {
                lat: n.lat!,
                lng: n.lng!,
                nights: 1,
              });
            }
          }
          if (n.distKm && n.distKm > maxDist) maxDist = n.distKm;
        }
        trips.push({
          startDate: tripNights[0].date,
          endDate: tripNights[tripNights.length - 1].date,
          nights: tripNights.length,
          places: [...placeCount.entries()].map(([placeId, p]) => ({
            placeId,
            ...p,
          })),
          maxDistKm: Math.round(maxDist),
        });
        tripStart = -1;
      }
    }
  }
  // Handle trip extending to the end
  if (tripStart !== -1) {
    const tripNights = nightsAway.slice(tripStart);
    const placeCount = new Map<
      string,
      { lat: number; lng: number; nights: number }
    >();
    let maxDist = 0;
    for (const n of tripNights) {
      if (n.placeId) {
        const existing = placeCount.get(n.placeId);
        if (existing) existing.nights++;
        else
          placeCount.set(n.placeId, { lat: n.lat!, lng: n.lng!, nights: 1 });
      }
      if (n.distKm && n.distKm > maxDist) maxDist = n.distKm;
    }
    trips.push({
      startDate: tripNights[0].date,
      endDate: tripNights[tripNights.length - 1].date,
      nights: tripNights.length,
      places: [...placeCount.entries()].map(([placeId, p]) => ({
        placeId,
        ...p,
      })),
      maxDistKm: Math.round(maxDist),
    });
  }

  console.log(`  ${trips.length} trips detected`);
  fs.writeFileSync(path.join(OUT, 'trips.json'), JSON.stringify(trips));

  // ========================================================================
  // 7. Activity log for statistics
  // ========================================================================
  // One row per activity segment, stored column-wise to keep the file small.
  // The frontend aggregates the rows inside the selected time range into
  // distance/count/duration by mode, per-period trends, and day-of-week /
  // hour-of-day patterns. Distances stay unrounded so sums are exact.
  console.log('Building activity log…');

  const modes: string[] = [];
  const modeIndex = new Map<string, number>();
  const activities = {
    date: [] as string[],
    hour: [] as number[],
    mode: [] as number[],
    meters: [] as number[],
    seconds: [] as number[],
  };
  let totalMeters = 0;

  for (const s of segments) {
    if (!s.activity) continue;
    const type = s.activity.topCandidate.type;
    let m = modeIndex.get(type);
    if (m === undefined) {
      m = modes.length;
      modes.push(type);
      modeIndex.set(type, m);
    }
    const start = localStart(s);
    activities.date.push(dateStr(start));
    // Local hour, straight from the local timestamp ("…T17:08:24…")
    activities.hour.push(parseInt(start.slice(11, 13), 10));
    activities.mode.push(m);
    activities.meters.push(s.activity.distanceMeters);
    activities.seconds.push(durationSec(s.startTime, s.endTime));
    totalMeters += s.activity.distanceMeters;
  }

  const stats = {
    // Local, so the date prefixes are the first and last nights' dates
    dateRange: {
      start: localStart(segments[0]),
      end: localEnd(segments[segments.length - 1]),
    },
    modes,
    activities,
  };

  console.log(`  ${activities.date.length} activities, ${Math.round(totalMeters / 1000).toLocaleString()} km`);
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(stats));

  // ========================================================================
  // 8. Route data for travel map (sampled to keep size manageable)
  // ========================================================================
  console.log('Extracting route data…');
  interface RouteSegment {
    /** Local start time */
    startTime: string;
    mode: string;
    points: [number, number][];
  }

  const routes: RouteSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s.activity) continue;
    const mode = s.activity.topCandidate.type;

    // Collect path points from preceding timelinePath if available
    let points: [number, number][] = [];
    if (i > 0 && segments[i - 1].timelinePath) {
      for (const p of segments[i - 1].timelinePath!) {
        points.push(parseLatLng(p.point));
      }
    }
    if (points.length < 2) {
      // Use start/end as fallback
      points = [
        parseLatLng(s.activity.start.latLng),
        parseLatLng(s.activity.end.latLng),
      ];
    }

    // Downsample long paths to max 50 points
    if (points.length > 50) {
      const step = points.length / 50;
      const sampled: [number, number][] = [];
      for (let j = 0; j < 50; j++) {
        sampled.push(points[Math.floor(j * step)]);
      }
      sampled.push(points[points.length - 1]);
      points = sampled;
    }

    routes.push({
      startTime: localStart(s),
      mode,
      points,
    });
  }

  console.log(`  ${routes.length} route segments`);
  fs.writeFileSync(path.join(OUT, 'routes.json'), JSON.stringify(routes));

  writeOfflineCityDb(CITY_DB_PATH, cityResolver.getDb());
  const resolverStats = cityResolver.getStats();
  console.log(
    `Offline city DB updated: ${resolverStats.totalEntries} entries ` +
      `(cache: ${resolverStats.cacheHits}, online: ${resolverStats.onlineHits}, fallback: ${resolverStats.fallbackHits}, online lookups used: ${resolverStats.onlineLookupsUsed})`,
  );

  console.log('\nDone! Output files in public/data/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
