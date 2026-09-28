/**
 * Pure aggregations over the preprocessed per-record data for a date range.
 *
 * Every range-dependent number in the UI is computed here, so "All time"
 * (an open range) runs through the same code as any other selection. Sums
 * run in record order and round the same way preprocess used to round its
 * all-time totals, so the unfiltered numbers match exactly.
 */
import type { Stats, Visit, Trip, GeographyData, HomePeriod, FamilyHome, NightEntry, Flight } from './types';
import {
  inRange,
  overlapsRange,
  dayOfWeek,
  dayNumber,
  addDays,
  periodKey,
  periodLabel,
  yearRange,
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
 * Mirrors periodIndexForDate (src/pipeline/homes.ts): a night outside every
 * period belongs to the nearest one in time (ties to the earlier), so a
 * period reaches halfway into the gaps around it, and the first and last
 * periods extend indefinitely.
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

/** "Utrecht, Netherlands", falling back to coordinates. */
export function homePlaceName(period: HomePeriod): string {
  if (period.city) return period.country ? `${period.city}, ${period.country}` : period.city;
  return `${period.lat.toFixed(4)}, ${period.lng.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Family homes (family-homes.json, `family` on nights-away.json)
//
// A family-home night is not away (isHome is true, so every "!isHome" count
// already leaves it out) but not at home either: it is its own, third kind.
// ---------------------------------------------------------------------------

/** A night at your own home: not away, and not at a family home. */
export function isOwnHomeNight(night: NightEntry): boolean {
  return night.isHome && !night.family;
}

/** Labels of the family homes slept at among `nights`, first-seen order. */
export function familyNightLabels(nights: NightEntry[]): string[] {
  const labels = new Set<string>();
  for (const n of nights) if (n.family) labels.add(n.family);
  return [...labels];
}

/**
 * The family homes with a family night spent there in the range (matched by
 * label). Nights there while it was your home are plain home nights, so a
 * family home you later moved into drops out of ranges after the move.
 */
export function familyHomesInRange(homes: FamilyHome[], nights: NightEntry[], range: DateRange): FamilyHome[] {
  const labels = new Set(familyNightLabels(nights.filter((n) => n.family && inRange(n.date, range))));
  return homes.filter((h) => labels.has(h.label));
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

// ---------------------------------------------------------------------------
// Firsts & streaks (nights-away.json, geography.json, flights.json)
//
// "New" countries/cities are always all-time — the year of their first-ever
// presence/night — never relative to the selected range (a range only
// changes which of those years get displayed; see rangeOverlapsYear).
// Streaks are the opposite: computed only from nights inside the selected
// range, clipped at its edges like every other range-aware aggregation here.
// ---------------------------------------------------------------------------

export interface YearFirsts<T> {
  year: number;
  items: T[];
}

function groupFirstYears<T>(
  firstYear: Map<number, number>,
  build: (index: number) => T,
  sortItems: (a: T, b: T) => number,
): YearFirsts<T>[] {
  const byYear = new Map<number, number[]>();
  for (const [index, year] of firstYear) {
    const list = byYear.get(year);
    if (list) list.push(index);
    else byYear.set(year, [index]);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, indices]) => ({ year, items: indices.map(build).sort(sortItems) }));
}

/**
 * Countries grouped by the year of their first-ever day present (from
 * `presence`, all-time, ISO-merged countries), ascending by year.
 */
export function newCountriesByYear(geo: GeographyData): YearFirsts<{ country: string; iso3: string | null }>[] {
  const firstYear = new Map<number, number>();
  for (const [date, countries] of geo.presence) {
    const year = +date.slice(0, 4);
    for (const c of countries) if (!firstYear.has(c)) firstYear.set(c, year);
  }
  return groupFirstYears(
    firstYear,
    (i) => geo.countries[i],
    (a, b) => a.country.localeCompare(b.country),
  );
}

/** Cities grouped by the year of their first-ever away night (from `nights`, all-time). */
export function newCitiesByYear(geo: GeographyData): YearFirsts<{ city: string; country: string }>[] {
  const firstYear = new Map<number, number>();
  for (const n of geo.nights) {
    if (n.city === null) continue;
    const year = +n.date.slice(0, 4);
    if (!firstYear.has(n.city)) firstYear.set(n.city, year);
  }
  return groupFirstYears(
    firstYear,
    (i) => ({ city: geo.cities[i].city, country: geo.countries[geo.cities[i].country].country }),
    (a, b) => a.city.localeCompare(b.city),
  );
}

/** Whether a calendar year has any day inside `range` (open bounds included). */
export function rangeOverlapsYear(range: DateRange, year: number): boolean {
  return overlapsRange(`${year}-01-01`, `${year}-12-31`, range);
}

/** The year with the most first-evers, ties keep the earliest year. */
export function peakYear<T>(byYear: YearFirsts<T>[]): YearFirsts<T> | null {
  return byYear.length
    ? byYear.reduce((a, b) => (b.items.length > a.items.length ? b : a))
    : null;
}

export interface Streak {
  start: string;
  end: string;
  nights: number;
}

/**
 * Longest run of consecutive calendar nights matching `matches`, within
 * `range` (clipped at its edges, same rule as every range-aware aggregation
 * here). A night missing from `nights` — untracked — breaks the streak just
 * like a night that fails `matches`, since the run only advances between
 * calendar-adjacent entries; nights-away.json is dated day by day, so this
 * only matters if tracking itself has a gap.
 */
export function longestNightStreak(
  nights: NightEntry[],
  range: DateRange,
  matches: (n: NightEntry) => boolean,
): Streak | null {
  let best: Streak | null = null;
  let run: Streak | null = null;
  let prevDate: string | null = null;

  for (const n of nights) {
    if (!inRange(n.date, range)) continue;
    if (matches(n)) {
      const contiguous = prevDate !== null && dayNumber(n.date) === dayNumber(prevDate) + 1;
      run = contiguous && run
        ? { start: run.start, end: n.date, nights: run.nights + 1 }
        : { start: n.date, end: n.date, nights: 1 };
      if (!best || run.nights > best.nights) best = run;
    } else {
      run = null;
    }
    prevDate = n.date;
  }
  return best;
}

/**
 * Distinct cities slept in during a streak, first-seen order. Fully
 * deduplicated (not just consecutive nights) since a streak can loop back
 * through the same base city — e.g. a multi-stop trip with a home-base city
 * revisited between side trips — and repeating that name in a chip list adds
 * nothing.
 */
export function streakCities(geo: GeographyData, streak: Streak): string[] {
  const span: DateRange = { start: streak.start, end: streak.end };
  const seen = new Set<string>();
  const names: string[] = [];
  for (const night of geo.nights) {
    if (!inRange(night.date, span)) continue;
    if (night.city === null) continue;
    const name = geo.cities[night.city].city;
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** The single farthest-ever night from home (all-time, ignores the selected range). */
export function farthestNightEver(nights: NightEntry[]): NightEntry | null {
  let best: NightEntry | null = null;
  for (const n of nights) {
    if (n.isHome || n.distKm == null) continue;
    if (!best || n.distKm > (best.distKm ?? -Infinity)) best = n;
  }
  return best;
}

/** The earliest-dated flight (all-time). */
export function firstFlightEver(flights: Flight[]): Flight | null {
  let best: Flight | null = null;
  for (const f of flights) {
    if (!best || f.date < best.date) best = f;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Year vs. year comparison (Compare page)
//
// Two whole calendar years shown side by side, independent of the global
// time range. Reuses summarizeActivities/summarizeVisits/summarizeGeography
// and the "firsts" helpers above (called once per year, range = yearRange(y))
// — these two helpers add the piece those don't cover: aligning two years'
// monthly series by calendar month (Jan first) for an overlay chart, and
// merging two years' per-mode figures into comparison rows.
// ---------------------------------------------------------------------------

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface MonthlyPair {
  /** 1–12 */
  month: number;
  label: string;
  a: number;
  b: number;
}

/**
 * Two years of a monthly metric aligned by calendar month (Jan → Dec), for
 * overlaying as two series on one chart. `valuesA`/`valuesB` are 'YYYY-MM' →
 * value maps for their own year — e.g. summarizeActivities(stats,
 * yearRange(year), { granularity: 'month', keys: [] }).distanceByPeriod, or
 * monthlyAwayNights below. Missing months are zero-filled.
 */
export function alignMonths(
  yearA: number,
  valuesA: Map<string, number>,
  yearB: number,
  valuesB: Map<string, number>,
): MonthlyPair[] {
  return MONTH_ABBR.map((label, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return {
      month: i + 1,
      label,
      a: Math.round(valuesA.get(`${yearA}-${mm}`) ?? 0),
      b: Math.round(valuesB.get(`${yearB}-${mm}`) ?? 0),
    };
  });
}

/** Away nights per month ('YYYY-MM' → count) within one calendar year. */
export function monthlyAwayNights(nights: NightEntry[], year: number): Map<string, number> {
  const range = yearRange(year);
  const counts = new Map<string, number>();
  for (const n of nights) {
    if (n.isHome || !inRange(n.date, range)) continue;
    const key = n.date.slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface ModeComparisonRow {
  mode: string;
  a: number;
  b: number;
}

/**
 * Two years' per-mode figures (e.g. distanceByMode) merged into rows sorted
 * by combined size, for a grouped bar chart or a stat-row list. Excludes
 * UNKNOWN_ACTIVITY_TYPE, like every other mode breakdown in this app.
 */
export function compareByMode(
  a: Record<string, number>,
  b: Record<string, number>,
  topN = 8,
): ModeComparisonRow[] {
  const modes = new Set([...Object.keys(a), ...Object.keys(b)]);
  modes.delete('UNKNOWN_ACTIVITY_TYPE');
  return [...modes]
    .map((mode) => ({ mode, a: a[mode] ?? 0, b: b[mode] ?? 0 }))
    .sort((x, y) => y.a + y.b - (x.a + x.b))
    .slice(0, topN);
}
