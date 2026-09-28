/**
 * Pure aggregations over the preprocessed per-record data for a date range.
 *
 * Every range-dependent number in the UI is computed here, so "All time"
 * (an open range) runs through the same code as any other selection. Sums
 * run in record order and round the same way preprocess used to round its
 * all-time totals, so the unfiltered numbers match exactly.
 */
import type { Stats, Visit, Trip, GeographyData, HomePeriod } from './types';
import {
  inRange,
  overlapsRange,
  dayOfWeek,
  dayNumber,
  addDays,
  periodKey,
  periodLabel,
  type DateRange,
  type Periods,
} from './timeRange';

// ---------------------------------------------------------------------------
// Activities (stats.json)
// ---------------------------------------------------------------------------

export interface ActivitySummary {
  /** Number of activities in range */
  count: number;
  /** km per mode, rounded; only modes with activity in range */
  distanceByMode: Record<string, number>;
  countByMode: Record<string, number>;
  /** Hours per mode, one decimal */
  durationByMode: Record<string, number>;
  /** Sum of the rounded per-mode distances */
  totalDistanceKm: number;
  /** Activity starts per weekday, Sunday first */
  dayOfWeek: number[];
  /** Activity starts per hour of day, 0–23 */
  hourOfDay: number[];
  /** Unrounded km per period key (only filled when `periods` is given) */
  distanceByPeriod: Map<string, number>;
}

export function summarizeActivities(
  stats: Stats,
  range: DateRange,
  periods?: Periods,
): ActivitySummary {
  const { date, hour, mode, meters, seconds } = stats.activities;
  const modeCount = stats.modes.length;
  const km = new Array<number>(modeCount).fill(0);
  const hours = new Array<number>(modeCount).fill(0);
  const counts = new Array<number>(modeCount).fill(0);
  const dow = new Array<number>(7).fill(0);
  const hod = new Array<number>(24).fill(0);
  const distanceByPeriod = new Map<string, number>();
  let count = 0;

  for (let i = 0; i < date.length; i++) {
    const d = date[i];
    if (!inRange(d, range)) continue;
    const m = mode[i];
    const dist = meters[i] / 1000;
    km[m] += dist;
    hours[m] += seconds[i] / 3600;
    counts[m]++;
    dow[dayOfWeek(d)]++;
    hod[hour[i]]++;
    if (periods) {
      const key = periodKey(d, periods.granularity);
      distanceByPeriod.set(key, (distanceByPeriod.get(key) ?? 0) + dist);
    }
    count++;
  }

  const distanceByMode: Record<string, number> = {};
  const countByMode: Record<string, number> = {};
  const durationByMode: Record<string, number> = {};
  let totalDistanceKm = 0;
  stats.modes.forEach((name, m) => {
    if (counts[m] === 0) return;
    distanceByMode[name] = Math.round(km[m]);
    countByMode[name] = counts[m];
    durationByMode[name] = Math.round(hours[m] * 10) / 10;
    totalDistanceKm += distanceByMode[name];
  });

  return {
    count,
    distanceByMode,
    countByMode,
    durationByMode,
    totalDistanceKm,
    dayOfWeek: dow,
    hourOfDay: hod,
    distanceByPeriod,
  };
}

// ---------------------------------------------------------------------------
// Places (visits.json)
// ---------------------------------------------------------------------------

export interface PlaceSummary {
  placeId: string;
  lat: number;
  lng: number;
  semanticType: string;
  /** Resolved city/country name; absent if unresolved */
  city?: string;
  country?: string;
  /** Stays in range */
  visitCount: number;
  /** Hours spent in range, one decimal */
  totalHours: number;
}

export interface VisitSummary {
  /** Places with at least one stay in range, most visited first */
  places: PlaceSummary[];
  /** Distinct places visited per period key (only filled when `periods` is given) */
  placesByPeriod: Map<string, number>;
}

export function isHomePlace(semanticType: string): boolean {
  return semanticType === 'INFERRED_HOME' || semanticType === 'HOME';
}

export function summarizeVisits(visits: Visit[], range: DateRange, periods?: Periods): VisitSummary {
  const places: PlaceSummary[] = [];
  const placesByPeriod = new Map<string, number>();

  for (const v of visits) {
    let visitCount = 0;
    let seconds = 0;
    const periodsSeen = new Set<string>();
    for (const [date, duration] of v.stays) {
      if (!inRange(date, range)) continue;
      visitCount++;
      seconds += duration;
      if (periods) periodsSeen.add(periodKey(date, periods.granularity));
    }
    if (visitCount === 0) continue;
    places.push({
      placeId: v.placeId,
      lat: v.lat,
      lng: v.lng,
      semanticType: v.semanticType,
      city: v.city,
      country: v.country,
      visitCount,
      totalHours: Math.round(seconds / 360) / 10,
    });
    for (const key of periodsSeen) placesByPeriod.set(key, (placesByPeriod.get(key) ?? 0) + 1);
  }

  // Stable sort: ties keep visits.json order (itself sorted by all-time visits)
  places.sort((a, b) => b.visitCount - a.visitCount);
  return { places, placesByPeriod };
}

// ---------------------------------------------------------------------------
// Home periods (home.json)
// ---------------------------------------------------------------------------

/** Whether a home.json predates home periods (it used to be a single {lat, lng}). */
export function isStaleHome(home: HomePeriod[]): boolean {
  return !Array.isArray(home) || home.some((p) => typeof p?.start !== 'string');
}

/**
 * The home periods that apply to some night in the range, oldest first.
 * Mirrors preprocess: a night outside every period belongs to the nearest
 * one in time (ties to the earlier), so a period reaches halfway into the
 * gaps around it, and the first and last periods extend indefinitely.
 */
export function homePeriodsInRange(periods: HomePeriod[], range: DateRange): HomePeriod[] {
  const reach = (end: string, nextStart: string) =>
    Math.floor((dayNumber(nextStart) - dayNumber(end)) / 2);
  return periods.filter((p, i) => {
    const prev = periods[i - 1];
    const next = periods[i + 1];
    const from = prev?.end ? addDays(prev.end, reach(prev.end, p.start) + 1) : '0000-01-01';
    const to = next && p.end ? addDays(p.end, reach(p.end, next.start)) : '9999-12-31';
    return overlapsRange(from, to, range);
  });
}

/** "2014–2026", "since 2026", or just "2024" within a single year. */
export function homePeriodYears(period: HomePeriod): string {
  const from = period.start.slice(0, 4);
  if (period.end === null) return `since ${from}`;
  const to = period.end.slice(0, 4);
  return from === to ? from : `${from}–${to}`;
}

/** "Eindhoven, Netherlands", falling back to coordinates. */
export function homePlaceName(period: HomePeriod): string {
  if (period.city) return period.country ? `${period.city}, ${period.country}` : period.city;
  return `${period.lat.toFixed(4)}, ${period.lng.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export function longestTrip(trips: Trip[]): Trip | null {
  return trips.length ? trips.reduce((a, b) => (a.nights > b.nights ? a : b)) : null;
}

export function furthestTrip(trips: Trip[]): Trip | null {
  return trips.length ? trips.reduce((a, b) => (a.maxDistKm > b.maxDistKm ? a : b)) : null;
}

// ---------------------------------------------------------------------------
// Geography (geography.json)
// ---------------------------------------------------------------------------

export interface GeographyCountry {
  country: string;
  /** ISO 3166-1 alpha-3 of the matching world-countries.geo.json feature; null if unmatched */
  iso3: string | null;
  /** Nights away from home spent in the country, in range */
  days: number;
  shareOfAwayDays: number;
  /** Days present in range: dates with at least one recorded visit there, home time included */
  totalDays: number;
}

export interface GeographyCity {
  city: string;
  country: string;
  lat: number;
  lng: number;
  days: number;
  shareOfAwayDays: number;
}

export interface GeographyStats {
  totalAwayDays: number;
  /** Away days that resolved to a city (and therefore a country) */
  matchedDays: number;
  unmatchedDays: number;
  /** Countries with an away night or a day present in range; most away days first */
  countries: GeographyCountry[];
  /** Most days first */
  cities: GeographyCity[];
}

/** Whether a geography.json predates the per-date country presence data. */
export function isStaleGeography(geo: GeographyData): boolean {
  return !Array.isArray(geo.countries) || !Array.isArray(geo.presence);
}

export function summarizeGeography(geo: GeographyData, range: DateRange): GeographyStats {
  const countryDays = new Array<number>(geo.countries.length).fill(0);
  const presentDays = new Array<number>(geo.countries.length).fill(0);
  const cityDays = new Map<number, number>();
  let totalAwayDays = 0;
  let unmatchedDays = 0;

  for (const night of geo.nights) {
    if (!inRange(night.date, range)) continue;
    totalAwayDays++;
    if (night.city === null) {
      unmatchedDays++;
      continue;
    }
    countryDays[geo.cities[night.city].country]++;
    cityDays.set(night.city, (cityDays.get(night.city) ?? 0) + 1);
  }

  for (const [date, present] of geo.presence) {
    if (!inRange(date, range)) continue;
    for (const country of present) presentDays[country]++;
  }

  const share = (days: number) =>
    totalAwayDays ? Math.round((days / totalAwayDays) * 1000) / 10 : 0;

  const countries = geo.countries
    .map((c, i) => ({
      country: c.country,
      iso3: c.iso3,
      days: countryDays[i],
      shareOfAwayDays: share(countryDays[i]),
      totalDays: presentDays[i],
    }))
    .filter((c) => c.days > 0 || c.totalDays > 0)
    .sort(
      (a, b) =>
        b.days - a.days ||
        b.totalDays - a.totalDays ||
        a.country.localeCompare(b.country),
    );

  const cities = [...cityDays]
    .map(([index, days]) => {
      const { city, country, lat, lng } = geo.cities[index];
      return {
        city,
        country: geo.countries[country].country,
        lat,
        lng,
        days,
        shareOfAwayDays: share(days),
      };
    })
    .sort(
      (a, b) =>
        b.days - a.days ||
        a.country.localeCompare(b.country) ||
        a.city.localeCompare(b.city),
    );

  return {
    totalAwayDays,
    matchedDays: totalAwayDays - unmatchedDays,
    unmatchedDays,
    countries,
    cities,
  };
}

// ---------------------------------------------------------------------------
// Per-period chart series
// ---------------------------------------------------------------------------

export interface PeriodPoint {
  key: string;
  label: string;
  value: number;
}

export function countByPeriod(dates: string[], periods: Periods): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = periodKey(date, periods.granularity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Chart series with one point per period of the range, zero-filled, plus any
 * period that occurs in the data but falls just outside the data bounds.
 */
export function periodSeries(
  periods: Periods,
  values: Map<string, number>,
  transform: (value: number) => number = (v) => v,
): PeriodPoint[] {
  const keys = new Set(periods.keys);
  for (const key of values.keys()) keys.add(key);
  return [...keys].sort().map((key) => ({
    key,
    label: periodLabel(key),
    value: transform(values.get(key) ?? 0),
  }));
}
