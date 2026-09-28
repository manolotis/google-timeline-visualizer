/**
 * Home periods: where the user lived, and when.
 *
 * People move, so "home" is a list of periods rather than one place. Google's
 * HOME / INFERRED_HOME labels say *which* places were homes, but they are too
 * sparse and inconsistent to say *when* (whole months go unlabelled, and a
 * family home you stay at over Christmas gets labelled INFERRED_HOME too). So
 * the labels only nominate candidate homes; the timeline comes from where
 * you actually slept each night:
 *
 *   1. Cluster the labelled visits into candidate homes (HOME_RADIUS_KM).
 *   2. Label each month with the candidate you slept at most that month
 *      (strict plurality; months without such nights, or tied, stay unlabelled).
 *   3. Consecutive months with the same label form segments. Repeatedly drop
 *      the weakest segment whose support (months) is below the minimum; when
 *      a dropped segment sat between two segments of the same home they merge,
 *      and the merged support is net of the dropped months. Christmas at your
 *      parents' or a three-month stint abroad thus stays a trip, and patchy
 *      early data that alternates between two places can't add up to a home.
 *   4. Turn the surviving segments into dated periods: a period ends on the
 *      last night slept at its home up to the next home's first month, and the
 *      next starts on the first night at the new home after that. The first
 *      period starts on the first night at its home; the last is ongoing.
 *
 * Nights outside every period (before the first one, or in the gap between
 * two periods) belong to the nearest period in time, ties going to the
 * earlier one (see periodIndexForDate).
 */
import { dayNumber, haversineDist, median } from './util';

/** Within this distance of a home you are at home; also the clustering radius. */
export const HOME_RADIUS_KM = 1;

/**
 * Months (net) a place must be where you slept most to count as a home —
 * longer than a summer at family or a research stint abroad, short enough
 * that a move shows up within half a year.
 */
export const DEFAULT_HOME_MIN_PERIOD_MONTHS = 5;

/** A HOME / INFERRED_HOME visit */
export interface HomeSample {
  lat: number;
  lng: number;
  /** Raw "lat°, lng°" string, used to group identical coordinates */
  latLng: string;
  /** Local start date */
  date: string;
}

/** A candidate home: labelled visits within HOME_RADIUS_KM of each other. */
export interface HomeCluster {
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
export function clusterHomeSamples(samples: HomeSample[], radiusKm: number): HomeCluster[] {
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
export interface NightLocation {
  date: string;
  lat: number | null;
  lng: number | null;
}

export interface DetectedHomePeriod {
  /** Index into the clusters */
  cluster: number;
  /** First night at this home (night key) */
  start: string;
  /** Last night at this home; null for the latest (ongoing) period */
  end: string | null;
  /** Months this home was where you slept most, net of other homes' months inside the period */
  supportMonths: number;
}

export function detectHomePeriods(
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
 * a gap between two periods → the closer one, ties to the earlier). Must
 * agree with homePeriodsInRange in src/aggregate.ts.
 */
export function periodIndexForDate(periods: { start: string; end: string | null }[], date: string): number {
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
