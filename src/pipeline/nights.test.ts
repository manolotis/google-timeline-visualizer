/**
 * Night bucketing (run.ts §4): which local date a night belongs to, and
 * which visit/flight it was "spent at". These rules live inline in
 * runPipeline (not as standalone exported helpers), so they're exercised
 * end-to-end with tiny synthetic timelines rather than unit-tested directly.
 *
 * Every segment below uses an explicit UTC offset of 0 (offset fields set,
 * "Z" timestamps), so the night window under test is exactly
 * [date 20:00Z, date+1 08:00Z] with no local-time arithmetic surprises.
 */
import { describe, expect, it } from 'vitest';
import { buildCityDb } from './cities';
import { runPipeline, type PipelineInputs } from './run';
import type { RawSegment, RawTimeline } from './types';

const inputs: PipelineInputs = {
  cityDb: buildCityDb(null),
  countries: [],
  airports: [],
  familyHomes: [],
};

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

function flightSeg(opts: {
  start: string;
  end: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}): RawSegment {
  return {
    startTime: opts.start,
    endTime: opts.end,
    startTimeTimezoneUtcOffsetMinutes: 0,
    endTimeTimezoneUtcOffsetMinutes: 0,
    activity: {
      start: { latLng: latLng(opts.startLat, opts.startLng) },
      end: { latLng: latLng(opts.endLat, opts.endLng) },
      distanceMeters: 1_000_000,
      topCandidate: { type: 'FLYING', probability: 1 },
    },
  };
}

/** night entry helper */
function nightOn<T extends { date: string }>(nights: T[], date: string): T {
  const n = nights.find((x) => x.date === date);
  if (!n) throw new Error(`No night entry for ${date}`);
  return n;
}

describe('night bucketing', () => {
  it('assigns the night to the visit overlapping the 20:00-08:00 window most, not the longer visit', async () => {
    // Home for the surrounding nights, so the home period exists and the
    // contested night gets a resolved location (not the no-location fallback).
    const home = visitSeg({
      start: '2021-03-01T00:00:00Z',
      end: '2021-03-09T00:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    // Visit A: 19:00-21:00 -> overlaps the night window (20:00-08:00) by 1h.
    const visitA = visitSeg({
      start: '2021-03-10T19:00:00Z',
      end: '2021-03-10T21:00:00Z',
      lat: 50,
      lng: 50,
      placeId: 'A',
    });
    // Visit B: 21:30-23:00 -> entirely inside the window, 1.5h overlap.
    // Shorter in wall-clock time than A, but it overlaps the night more.
    const visitB = visitSeg({
      start: '2021-03-10T21:30:00Z',
      end: '2021-03-10T23:00:00Z',
      lat: 60,
      lng: 60,
      placeId: 'B',
    });
    const homeAgain = visitSeg({
      start: '2021-03-11T08:00:00Z',
      end: '2021-03-15T00:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    const timeline: RawTimeline = { semanticSegments: [home, visitA, visitB, homeAgain] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    const night = nightOn(datasets.nightsAway, '2021-03-10');
    expect(night.placeId).toBe('B');
    expect(night.lat).toBe(60);
    expect(night.lng).toBe(60);
    expect(night.isHome).toBe(false);
  });

  it('a visit entirely outside 20:00-08:00 does not win any night', async () => {
    const home = visitSeg({
      start: '2021-03-01T00:00:00Z',
      end: '2021-03-09T00:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    // A midday visit on 03-10 (12:00-13:00): outside every night's window.
    const midday = visitSeg({
      start: '2021-03-10T12:00:00Z',
      end: '2021-03-10T13:00:00Z',
      lat: 50,
      lng: 50,
      placeId: 'midday',
    });
    const homeAgain = visitSeg({
      start: '2021-03-11T08:00:00Z',
      end: '2021-03-15T00:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    const timeline: RawTimeline = { semanticSegments: [home, midday, homeAgain] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    // Neither night adjacent to the midday visit was won by it.
    const night9 = nightOn(datasets.nightsAway, '2021-03-09');
    const night10 = nightOn(datasets.nightsAway, '2021-03-10');
    expect(night9.placeId).not.toBe('midday');
    expect(night10.placeId).not.toBe('midday');
  });

  it('an overnight flight in the air at local midnight counts as a night away at the departure point', async () => {
    const home = visitSeg({
      start: '2021-06-01T00:00:00Z',
      end: '2021-06-03T08:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    // Departs 22:00 on 06-03, lands 06:00 on 06-04 (8h, spans midnight).
    const flight = flightSeg({
      start: '2021-06-03T22:00:00Z',
      end: '2021-06-04T06:00:00Z',
      startLat: 50,
      startLng: 50,
      endLat: 60,
      endLng: 60,
    });
    const timeline: RawTimeline = { semanticSegments: [home, flight] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    const night = nightOn(datasets.nightsAway, '2021-06-03');
    expect(night.isHome).toBe(false);
    expect(night.lat).toBe(50); // departure point, not the destination (60, 60)
    expect(night.lng).toBe(50);
  });

  it('a "flight" longer than 20h is a gap-filler artifact and does not claim a night', async () => {
    const home = visitSeg({
      start: '2021-06-01T00:00:00Z',
      end: '2021-06-03T08:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    // Also spans local midnight on 06-03, but takes 22h (> MAX_FLIGHT_MS).
    const longGap = flightSeg({
      start: '2021-06-03T20:00:00Z',
      end: '2021-06-04T18:00:00Z',
      startLat: 50,
      startLng: 50,
      endLat: 60,
      endLng: 60,
    });
    const timeline: RawTimeline = { semanticSegments: [home, longGap] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    const night = nightOn(datasets.nightsAway, '2021-06-03');
    // No visit and no (valid) flight claims the night: home by default,
    // with no location (per the documented "no location -> isHome" rule).
    expect(night.isHome).toBe(true);
    expect(night.lat).toBeUndefined();
    expect(night.placeId).toBeUndefined();
  });

  it('produces exactly one night per local date, contiguous from the first segment to the last, with no location defaulting to home', async () => {
    const stay = visitSeg({
      start: '2021-01-01T00:00:00Z',
      end: '2021-01-05T00:00:00Z',
      lat: 5,
      lng: 5,
      placeId: 'home',
      semanticType: 'HOME',
    });
    const timeline: RawTimeline = { semanticSegments: [stay] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    const dates = datasets.nightsAway.map((n) => n.date);
    expect(dates).toEqual(['2021-01-01', '2021-01-02', '2021-01-03', '2021-01-04', '2021-01-05']);
    expect(new Set(dates).size).toBe(dates.length);

    // The last night (01-05) is past where the visit ends (00:00), so no
    // visit overlaps its window; it still gets an entry, defaulted to home.
    const lastNight = nightOn(datasets.nightsAway, '2021-01-05');
    expect(lastNight.isHome).toBe(true);
    expect(lastNight.lat).toBeUndefined();

    // The fully-covered nights resolve to the visit, at home (dist 0).
    const firstNight = nightOn(datasets.nightsAway, '2021-01-01');
    expect(firstNight).toMatchObject({ isHome: true, lat: 5, lng: 5, distKm: 0, placeId: 'home' });
  });
});

describe('mid-trip gap nights', () => {
  const home = visitSeg({
    start: '2021-06-01T00:00:00Z',
    end: '2021-06-03T08:00:00Z',
    lat: 1,
    lng: 1,
    placeId: 'home',
    semanticType: 'HOME',
  });

  it('unlocated nights between two away nights count as away at the last located place, keeping the trip whole', async () => {
    // Away night 06-03 at hostel-a; nights 06-04 and 06-05 have no visit at
    // all (overnight bus, dead phone); away nights 06-06/07 at hostel-b.
    const awayA = visitSeg({
      start: '2021-06-03T12:00:00Z',
      end: '2021-06-04T08:00:00Z',
      lat: 50,
      lng: 50,
      placeId: 'hostel-a',
    });
    const awayB = visitSeg({
      start: '2021-06-06T10:00:00Z',
      end: '2021-06-08T08:00:00Z',
      lat: 51,
      lng: 51,
      placeId: 'hostel-b',
    });
    const homeAgain = visitSeg({
      start: '2021-06-08T12:00:00Z',
      end: '2021-06-10T08:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    const timeline: RawTimeline = { semanticSegments: [home, awayA, awayB, homeAgain] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    const anchor = nightOn(datasets.nightsAway, '2021-06-03');
    for (const date of ['2021-06-04', '2021-06-05']) {
      const gap = nightOn(datasets.nightsAway, date);
      expect(gap.isHome).toBe(false);
      expect(gap.lat).toBe(50); // carried forward from hostel-a, not back from hostel-b
      expect(gap.lng).toBe(50);
      expect(gap.placeId).toBe('hostel-a');
      expect(gap.distKm).toBe(anchor.distKm);
    }

    // One unbroken trip instead of two split by the phantom home nights
    expect(datasets.trips).toHaveLength(1);
    expect(datasets.trips[0]).toMatchObject({ startDate: '2021-06-03', endDate: '2021-06-07', nights: 5 });
    expect(datasets.trips[0].places).toContainEqual({ placeId: 'hostel-a', lat: 50, lng: 50, nights: 3 });
  });

  it('an unlocated night bordered by a located home night stays home: coming home still ends the trip', async () => {
    const away = visitSeg({
      start: '2021-06-03T12:00:00Z',
      end: '2021-06-04T08:00:00Z',
      lat: 50,
      lng: 50,
      placeId: 'hostel-a',
    });
    // Night 06-04 has no visit; the next located night (06-05) is at home.
    const homeAgain = visitSeg({
      start: '2021-06-05T12:00:00Z',
      end: '2021-06-07T08:00:00Z',
      lat: 1,
      lng: 1,
      placeId: 'home',
      semanticType: 'HOME',
    });
    const timeline: RawTimeline = { semanticSegments: [home, away, homeAgain] };

    const { datasets } = await runPipeline(timeline, inputs, { homeMinPeriodMonths: 1 });

    const gap = nightOn(datasets.nightsAway, '2021-06-04');
    expect(gap.isHome).toBe(true);
    expect(gap.lat).toBeUndefined();

    expect(datasets.trips).toHaveLength(1);
    expect(datasets.trips[0]).toMatchObject({ startDate: '2021-06-03', endDate: '2021-06-03', nights: 1 });
  });
});
