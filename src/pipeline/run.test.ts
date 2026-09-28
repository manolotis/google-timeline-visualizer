/**
 * End-to-end pipeline tests: a tiny synthetic Timeline export through
 * runPipeline, checking every dataset comes out, is internally consistent,
 * and is produced deterministically — plus family-home integration, which
 * (like night bucketing) is only observable through the full pipeline since
 * the isHome/family combination is assembled in run.ts, not in familyHomes.ts.
 *
 * All synthetic data: fake coordinates, fake place IDs, fake dates. Every
 * segment uses an explicit UTC offset of 0 ("Z" timestamps + offset fields
 * set to 0) so local dates match the UTC date shown in each segment.
 */
import { describe, expect, it } from 'vitest';
import { buildCityDb } from './cities';
import { runPipeline, type PipelineInputs } from './run';
import type { DatasetKey, RawSegment, RawTimeline } from './types';
import { DATASET_KEYS } from './datasets';

const latLng = (lat: number, lng: number) => `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;

function visitSeg(opts: {
  start: string;
  end: string;
  lat: number;
  lng: number;
  placeId: string;
  semanticType?: string;
}): RawSegment {
  return {
    startTime: opts.start,
    endTime: opts.end,
    startTimeTimezoneUtcOffsetMinutes: 0,
    endTimeTimezoneUtcOffsetMinutes: 0,
    visit: {
      hierarchyLevel: 0,
      probability: 1,
      topCandidate: {
        placeId: opts.placeId,
        semanticType: opts.semanticType ?? 'UNKNOWN',
        probability: 1,
        placeLocation: { latLng: latLng(opts.lat, opts.lng) },
      },
    },
  };
}

function activitySeg(opts: {
  start: string;
  end: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  type: string;
  distanceMeters?: number;
}): RawSegment {
  return {
    startTime: opts.start,
    endTime: opts.end,
    startTimeTimezoneUtcOffsetMinutes: 0,
    endTimeTimezoneUtcOffsetMinutes: 0,
    activity: {
      start: { latLng: latLng(opts.startLat, opts.startLng) },
      end: { latLng: latLng(opts.endLat, opts.endLng) },
      distanceMeters: opts.distanceMeters ?? 1000,
      topCandidate: { type: opts.type, probability: 1 },
    },
  };
}

function freshInputs(familyHomes: PipelineInputs['familyHomes'] = []): PipelineInputs {
  return {
    cityDb: buildCityDb(null),
    countries: [],
    airports: [],
    familyHomes,
  };
}

/**
 * A dozen segments: a round trip from a synthetic home to a synthetic
 * destination, with two visits besides HOME (a WORK stop and the
 * destination), two flights (there and back, "one flight" and then some),
 * and two walks plus a cycle ride for activity variety.
 */
function buildSmokeTimeline(): RawTimeline {
  const HOME = { lat: 1, lng: 1, placeId: 'home', semanticType: 'HOME' };
  const DEST = { lat: 30, lng: 30, placeId: 'dest' };
  const segments: RawSegment[] = [
    visitSeg({ start: '2022-01-01T00:00:00Z', end: '2022-01-02T08:00:00Z', ...HOME }),
    activitySeg({
      start: '2022-01-02T09:00:00Z',
      end: '2022-01-02T09:30:00Z',
      startLat: 1,
      startLng: 1,
      endLat: 1.01,
      endLng: 1.01,
      type: 'WALKING',
      distanceMeters: 2000,
    }),
    visitSeg({ start: '2022-01-02T09:30:00Z', end: '2022-01-03T09:00:00Z', ...HOME }),
    visitSeg({
      start: '2022-01-03T09:00:00Z',
      end: '2022-01-03T17:00:00Z',
      lat: 1.02,
      lng: 1.02,
      placeId: 'work',
      semanticType: 'WORK',
    }),
    visitSeg({ start: '2022-01-03T17:00:00Z', end: '2022-01-05T09:00:00Z', ...HOME }),
    activitySeg({
      start: '2022-01-05T09:00:00Z',
      end: '2022-01-05T13:00:00Z',
      startLat: 1,
      startLng: 1,
      endLat: 30,
      endLng: 30,
      type: 'FLYING',
      distanceMeters: 3_200_000,
    }),
    visitSeg({ start: '2022-01-05T13:30:00Z', end: '2022-01-08T09:00:00Z', ...DEST }),
    activitySeg({
      start: '2022-01-08T09:00:00Z',
      end: '2022-01-08T13:00:00Z',
      startLat: 30,
      startLng: 30,
      endLat: 1,
      endLng: 1,
      type: 'FLYING',
      distanceMeters: 3_200_000,
    }),
    visitSeg({ start: '2022-01-08T13:30:00Z', end: '2022-01-09T09:00:00Z', ...HOME }),
    activitySeg({
      start: '2022-01-09T09:00:00Z',
      end: '2022-01-09T09:20:00Z',
      startLat: 1,
      startLng: 1,
      endLat: 1.01,
      endLng: 1.01,
      type: 'WALKING',
      distanceMeters: 1500,
    }),
    visitSeg({ start: '2022-01-09T09:20:00Z', end: '2022-01-11T09:00:00Z', ...HOME }),
    activitySeg({
      start: '2022-01-11T09:00:00Z',
      end: '2022-01-11T09:45:00Z',
      startLat: 1,
      startLng: 1,
      endLat: 1.05,
      endLng: 1.05,
      type: 'CYCLING',
      distanceMeters: 6000,
    }),
  ];
  expect(segments).toHaveLength(12); // sanity-check the fixture itself
  return { semanticSegments: segments };
}

describe('runPipeline: end-to-end smoke test', () => {
  it('produces every dataset, with internally consistent shapes', async () => {
    const { datasets } = await runPipeline(buildSmokeTimeline(), freshInputs(), { homeMinPeriodMonths: 1 });

    // Every dataset key is present (DATASET_KEYS is the single source of truth).
    for (const key of DATASET_KEYS as DatasetKey[]) {
      expect(datasets).toHaveProperty(key);
    }

    // One night per local date, first segment to last, no gaps or duplicates.
    const dates = datasets.nightsAway.map((n) => n.date);
    expect(dates).toEqual([
      '2022-01-01',
      '2022-01-02',
      '2022-01-03',
      '2022-01-04',
      '2022-01-05',
      '2022-01-06',
      '2022-01-07',
      '2022-01-08',
      '2022-01-09',
      '2022-01-10',
      '2022-01-11',
    ]);
    expect(new Set(dates).size).toBe(dates.length);

    // The round trip is the only away stretch, and forms exactly one trip.
    expect(datasets.nightsAway.filter((n) => !n.isHome).map((n) => n.date)).toEqual([
      '2022-01-05',
      '2022-01-06',
      '2022-01-07',
    ]);
    expect(datasets.trips).toHaveLength(1);
    expect(datasets.trips[0]).toMatchObject({ startDate: '2022-01-05', endDate: '2022-01-07', nights: 3 });

    // One home period, starting on the first (home) night, still ongoing.
    expect(datasets.home).toHaveLength(1);
    expect(datasets.home[0]).toMatchObject({ start: '2022-01-01', end: null });

    // Two flights (there and back); one WORK + one destination visit besides HOME.
    expect(datasets.flights).toHaveLength(2);
    expect(datasets.visits.map((v) => v.placeId).sort()).toEqual(['dest', 'home', 'work']);

    // Away nights only: the 3 nights at the destination, nothing else.
    expect(datasets.geography.nights).toHaveLength(3);
    // Every index the geography dataset hands out resolves inside its own arrays.
    for (const n of datasets.geography.nights) {
      if (n.city !== null) {
        expect(n.city).toBeGreaterThanOrEqual(0);
        expect(n.city).toBeLessThan(datasets.geography.cities.length);
      }
    }
    for (const c of datasets.geography.cities) {
      expect(c.country).toBeGreaterThanOrEqual(0);
      expect(c.country).toBeLessThan(datasets.geography.countries.length);
    }
    for (const [, countryIds] of datasets.geography.presence) {
      for (const id of countryIds) {
        expect(id).toBeGreaterThanOrEqual(0);
        expect(id).toBeLessThan(datasets.geography.countries.length);
      }
    }

    // Column-wise activity log: every column the same length, one row per
    // activity segment (2 walks + 2 flights + 1 cycle = 5), every mode index in range.
    const { activities, modes } = datasets.stats;
    expect(activities.date).toHaveLength(5);
    for (const col of [activities.hour, activities.mode, activities.meters, activities.seconds]) {
      expect(col).toHaveLength(activities.date.length);
    }
    for (const m of activities.mode) {
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(modes.length);
    }
    expect(modes.sort()).toEqual(['CYCLING', 'FLYING', 'WALKING']);

    // One route per activity segment.
    expect(datasets.routes).toHaveLength(5);

    // No family-home config: always [], never undefined.
    expect(datasets.familyHomes).toEqual([]);
  });

  it('is deterministic: two independent runs on the same input produce byte-identical JSON', async () => {
    const [a, b] = await Promise.all([
      runPipeline(buildSmokeTimeline(), freshInputs(), { homeMinPeriodMonths: 1 }),
      runPipeline(buildSmokeTimeline(), freshInputs(), { homeMinPeriodMonths: 1 }),
    ]);
    expect(JSON.stringify(a.datasets)).toBe(JSON.stringify(b.datasets));
  });
});

describe('runPipeline: family homes', () => {
  it('a night within a family home\'s radius gets isHome: true and the family label, distinct from the period home', async () => {
    // Segment transitions at 09:00 (daytime), well clear of every night's
    // 20:00-08:00 window, so each night resolves unambiguously.
    const HOME = { lat: 1, lng: 1, placeId: 'home', semanticType: 'HOME' };
    const PARENTS = { lat: 2, lng: 2, placeId: 'parents' };
    const segments: RawSegment[] = [
      visitSeg({ start: '2022-02-01T00:00:00Z', end: '2022-02-04T09:00:00Z', ...HOME }),
      visitSeg({ start: '2022-02-04T09:00:00Z', end: '2022-02-05T09:00:00Z', ...PARENTS }),
      visitSeg({ start: '2022-02-05T09:00:00Z', end: '2022-02-08T09:00:00Z', ...HOME }),
    ];
    const inputs = freshInputs([{ lat: 2, lng: 2, label: 'Parents', radiusKm: 1 }]);

    const { datasets } = await runPipeline({ semanticSegments: segments }, inputs, { homeMinPeriodMonths: 1 });

    const night = datasets.nightsAway.find((n) => n.date === '2022-02-04');
    expect(night).toMatchObject({ isHome: true, family: 'Parents', lat: 2, lng: 2 });
    // distKm is still measured from the period home (far away), not the family home.
    expect(night?.distKm).toBeGreaterThan(100);

    // A family night isn't away: no trip, no geography entry for it.
    expect(datasets.trips).toHaveLength(0);
    expect(datasets.geography.nights).toHaveLength(0);

    expect(datasets.familyHomes).toEqual([{ label: 'Parents', lat: 2, lng: 2, radiusKm: 1 }]);
  });

  it('a family home that coincides with the period home stays plain home (no family field)', async () => {
    const HOME = { lat: 1, lng: 1, placeId: 'home', semanticType: 'HOME' };
    const segments: RawSegment[] = [
      visitSeg({ start: '2022-03-01T00:00:00Z', end: '2022-03-05T00:00:00Z', ...HOME }),
    ];
    // The "family home" is the same place they actually live.
    const inputs = freshInputs([{ lat: 1, lng: 1, label: 'Parents', radiusKm: 1 }]);

    const { datasets } = await runPipeline({ semanticSegments: segments }, inputs, { homeMinPeriodMonths: 1 });

    expect(datasets.nightsAway.length).toBeGreaterThan(0);
    for (const night of datasets.nightsAway) {
      expect(night.isHome).toBe(true);
      expect(night.family).toBeUndefined();
    }
  });

  it('an empty family-home config never adds a family field', async () => {
    const HOME = { lat: 1, lng: 1, placeId: 'home', semanticType: 'HOME' };
    const AWAY = { lat: 40, lng: 40, placeId: 'away' };
    const segments: RawSegment[] = [
      visitSeg({ start: '2022-04-01T00:00:00Z', end: '2022-04-03T00:00:00Z', ...HOME }),
      visitSeg({ start: '2022-04-03T00:00:00Z', end: '2022-04-05T00:00:00Z', ...AWAY }),
      visitSeg({ start: '2022-04-05T00:00:00Z', end: '2022-04-07T00:00:00Z', ...HOME }),
    ];
    const inputs = freshInputs([]); // no config

    const { datasets } = await runPipeline({ semanticSegments: segments }, inputs, { homeMinPeriodMonths: 1 });

    expect(datasets.familyHomes).toEqual([]);
    expect(datasets.nightsAway.every((n) => n.family === undefined)).toBe(true);
    // The away night is still correctly detected as away, just with no family involved.
    expect(datasets.nightsAway.some((n) => !n.isHome)).toBe(true);
  });
});
