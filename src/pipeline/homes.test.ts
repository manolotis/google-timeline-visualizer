import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_MIN_PERIOD_MONTHS,
  HOME_RADIUS_KM,
  clusterHomeSamples,
  detectHomePeriods,
  periodIndexForDate,
  type HomeCluster,
  type HomeSample,
  type NightLocation,
} from './homes';
import { dayNumber, dayString } from './util';

/** Every date from `start` to `end`, inclusive. */
function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = dayNumber(start); d <= dayNumber(end); d++) dates.push(dayString(d));
  return dates;
}

/** One night per date, all at the same synthetic coordinate. */
function nightsAt(dates: string[], lat: number, lng: number): NightLocation[] {
  return dates.map((date) => ({ date, lat, lng }));
}

// Two synthetic home clusters, far enough apart that HOME_RADIUS_KM never
// confuses them.
const CLUSTER_A: HomeCluster = { lat: 10, lng: 10, samples: [], seedLat: 10, seedLng: 10 };
const CLUSTER_B: HomeCluster = { lat: 20, lng: 20, samples: [], seedLat: 20, seedLng: 20 };

describe('detectHomePeriods', () => {
  it('detects two periods across a mid-way move (month-aligned)', () => {
    const nightsA = nightsAt(dateRange('2019-01-01', '2020-06-30'), CLUSTER_A.lat, CLUSTER_A.lng); // 18 months
    const nightsB = nightsAt(dateRange('2020-07-01', '2021-12-31'), CLUSTER_B.lat, CLUSTER_B.lng); // 18 months
    const nights = [...nightsA, ...nightsB];

    const periods = detectHomePeriods(nights, [CLUSTER_A, CLUSTER_B], DEFAULT_HOME_MIN_PERIOD_MONTHS);

    expect(periods).toEqual([
      { cluster: 0, start: '2019-01-01', end: '2020-06-30', supportMonths: 18 },
      { cluster: 1, start: '2020-07-01', end: null, supportMonths: 18 },
    ]);
  });

  it('does not turn a 4-month COVID-like stay into its own home period', () => {
    const before = nightsAt(dateRange('2019-01-01', '2019-06-30'), CLUSTER_A.lat, CLUSTER_A.lng); // 6 months
    const away = nightsAt(dateRange('2019-07-01', '2019-10-31'), CLUSTER_B.lat, CLUSTER_B.lng); // 4 months
    const after = nightsAt(dateRange('2019-11-01', '2020-04-30'), CLUSTER_A.lat, CLUSTER_A.lng); // 6 months
    const nights = [...before, ...away, ...after];

    const periods = detectHomePeriods(nights, [CLUSTER_A, CLUSTER_B], DEFAULT_HOME_MIN_PERIOD_MONTHS);

    // The 4-month stay away is below HOME_MIN_PERIOD_MONTHS (5) and merges
    // back into the surrounding cluster-A segments: still just one period,
    // at cluster A, never a period at cluster B.
    expect(periods).toHaveLength(1);
    expect(periods[0].cluster).toBe(0);
    expect(periods.some((p) => p.cluster === 1)).toBe(false);
  });

  it('merges a sub-threshold interruption with net support (prev + next - dropped)', () => {
    const before = nightsAt(dateRange('2019-01-01', '2019-06-30'), CLUSTER_A.lat, CLUSTER_A.lng); // 6 months
    const away = nightsAt(dateRange('2019-07-01', '2019-09-30'), CLUSTER_B.lat, CLUSTER_B.lng); // 3 months
    const after = nightsAt(dateRange('2019-10-01', '2020-04-30'), CLUSTER_A.lat, CLUSTER_A.lng); // 7 months
    const nights = [...before, ...away, ...after];

    const periods = detectHomePeriods(nights, [CLUSTER_A, CLUSTER_B], DEFAULT_HOME_MIN_PERIOD_MONTHS);

    expect(periods).toEqual([{ cluster: 0, start: '2019-01-01', end: null, supportMonths: 6 + 7 - 3 }]);
  });

  it('never merges alternating, equally-short segments of different clusters (only same-cluster neighbors merge)', () => {
    // Two months at A, two at B, repeated: every segment is < 5 months, and
    // consecutive segments always belong to *different* clusters, so the
    // "merge with a same-cluster neighbor" path never applies — each drop is
    // a plain removal, whittling down to whichever segment is chronologically
    // last, which still doesn't reach the minimum on its own.
    const nights = [
      ...nightsAt(dateRange('2013-01-01', '2013-02-28'), CLUSTER_A.lat, CLUSTER_A.lng),
      ...nightsAt(dateRange('2013-03-01', '2013-04-30'), CLUSTER_B.lat, CLUSTER_B.lng),
      ...nightsAt(dateRange('2013-05-01', '2013-06-30'), CLUSTER_A.lat, CLUSTER_A.lng),
      ...nightsAt(dateRange('2013-07-01', '2013-08-31'), CLUSTER_B.lat, CLUSTER_B.lng),
    ];

    const periods = detectHomePeriods(nights, [CLUSTER_A, CLUSTER_B], DEFAULT_HOME_MIN_PERIOD_MONTHS);

    // The surviving period never reaches HOME_MIN_PERIOD_MONTHS support: it
    // is whatever segment is left standing after the others are dropped, not
    // a merged, well-supported home.
    expect(periods).toHaveLength(1);
    expect(periods[0].supportMonths).toBeLessThan(DEFAULT_HOME_MIN_PERIOD_MONTHS);
  });

  it('leaves nights unlabelled (no home) when no cluster is within HOME_RADIUS_KM', () => {
    const farAway: NightLocation[] = dateRange('2020-01-01', '2020-06-30').map((date) => ({
      date,
      lat: 80,
      lng: 80,
    }));
    const periods = detectHomePeriods(farAway, [CLUSTER_A], DEFAULT_HOME_MIN_PERIOD_MONTHS);
    expect(periods).toHaveLength(0);
  });
});

describe('clusterHomeSamples', () => {
  const sample = (lat: number, lng: number, date: string): HomeSample => ({
    lat,
    lng,
    latLng: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`,
    date,
  });

  it('merges samples within the radius into one cluster, at their median', () => {
    const samples = [sample(10.0, 10.0, '2020-01-01'), sample(10.0001, 10.0, '2020-02-01'), sample(9.9999, 10.0, '2020-03-01')];
    const clusters = clusterHomeSamples(samples, HOME_RADIUS_KM);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].lat).toBeCloseTo(10.0, 4);
    expect(clusters[0].samples).toHaveLength(3);
  });

  it('keeps samples farther apart than the radius as separate clusters', () => {
    const samples = [sample(10, 10, '2020-01-01'), sample(20, 20, '2020-01-02')];
    const clusters = clusterHomeSamples(samples, HOME_RADIUS_KM);
    expect(clusters).toHaveLength(2);
  });

  it('returns no clusters for no samples', () => {
    expect(clusterHomeSamples([], HOME_RADIUS_KM)).toEqual([]);
  });
});

describe('periodIndexForDate', () => {
  const periods = [
    { start: '2020-01-10', end: '2020-06-10' },
    { start: '2020-06-20', end: null },
  ];

  it('returns the first period for a date before it starts', () => {
    expect(periodIndexForDate(periods, '2019-12-01')).toBe(0);
  });

  it('returns the containing period for a date inside it', () => {
    expect(periodIndexForDate(periods, '2020-03-01')).toBe(0);
  });

  it('returns the ongoing (open-ended) period for a date after its start', () => {
    expect(periodIndexForDate(periods, '2021-01-01')).toBe(1);
  });

  it('in a gap, returns the nearer period in time', () => {
    // 4 days after period 0 ends, 6 days before period 1 starts.
    expect(periodIndexForDate(periods, '2020-06-14')).toBe(0);
  });

  it('in a gap, ties go to the earlier period', () => {
    // 5 days after period 0 ends, 5 days before period 1 starts.
    expect(periodIndexForDate(periods, '2020-06-15')).toBe(0);
  });

  it('a single period applies to every date', () => {
    expect(periodIndexForDate([{ start: '2020-01-01', end: null }], '1999-01-01')).toBe(0);
    expect(periodIndexForDate([{ start: '2020-01-01', end: null }], '2099-01-01')).toBe(0);
  });
});
