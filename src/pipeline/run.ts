/**
 * The preprocessing pipeline: a parsed Timeline.json export plus reference
 * data in, every dataset out.
 *
 * Environment-agnostic on purpose: no file system, no network, no DOM or
 * Node APIs. The Node CLI (scripts/preprocess.ts) reads the files and env,
 * optionally plugs in its online geocoder, and writes public/data/*.json;
 * the in-browser import (src/import/worker.ts) runs the same code in a Web
 * Worker, offline-only, and keeps the result in IndexedDB. Given the same
 * inputs both produce byte-identical JSON.
 *
 * Everything the dashboard shows depends on the global time-range filter, so
 * the pipeline emits dated per-record data rather than all-time totals; the
 * frontend (src/aggregate.ts) sums whatever falls inside the selected range.
 * Every date is a local calendar date where the user was at the time, taken
 * from the export's per-segment UTC offsets (see "Local time" in util.ts).
 */
import { estimateFlightCo2Kg, findNearestAirport } from './airports';
import { CityResolver, type CityDb, type CityResolverStats, type OnlineGeocoder } from './cities';
import { buildCountryIndex, normalizeCountryName } from './countries';
import type { PipelinePhase } from './datasets';
import { familyHomeAt } from './familyHomes';
import {
  DEFAULT_HOME_MIN_PERIOD_MONTHS,
  HOME_RADIUS_KM,
  clusterHomeSamples,
  detectHomePeriods,
  periodIndexForDate,
  type HomeSample,
} from './homes';
import type {
  AirportEntry,
  Datasets,
  FamilyHome,
  FamilyHomeConfig,
  Flight,
  GeographyData,
  HomePeriod,
  MatchedAirport,
  NightEntry,
  RawTimeline,
  RouteSegment,
  Stats,
  Trip,
  Visit,
  WorldCountryNames,
} from './types';
import {
  DAY_MS,
  dateStr,
  dayNumber,
  dayString,
  durationMin,
  durationSec,
  endOffsetMinutes,
  haversineDist,
  localEnd,
  localStart,
  parseLatLng,
  startOffsetMinutes,
} from './util';

export interface PipelineInputs {
  /**
   * The offline city DB (buildCityDb). Resolution adds every new lookup to
   * it, so after the run it holds what the CLI writes back.
   */
  cityDb: CityDb;
  /** Name fields of the world geometry's features (public/world-countries.geo.json) */
  countries: WorldCountryNames[];
  /** scripts/data/airports.json; [] leaves flights without airports */
  airports: AirportEntry[];
  /** From timeline-config.json (parseTimelineConfig); [] for none */
  familyHomes: FamilyHomeConfig[];
}

export interface PipelineOptions {
  /** See DEFAULT_HOME_MIN_PERIOD_MONTHS */
  homeMinPeriodMonths?: number;
  /** Online lookups for city-DB misses (CLI only); offline-only without one */
  geocoder?: OnlineGeocoder;
  /** Retry the DB's 'fallback' entries through the geocoder */
  refreshFallbackEntries?: boolean;
  /** Called as each phase starts, and with a detail (e.g. "400/598") inside long ones */
  onProgress?: (phase: PipelinePhase, detail?: string) => void;
  /** Progress and summary lines (the CLI prints them) */
  log?: (message: string) => void;
  /** Data problems worth a look, e.g. countries missing from the world geometry */
  warn?: (message: string) => void;
}

export interface PipelineResult {
  datasets: Datasets;
  cityStats: CityResolverStats;
}

/** Thrown by validateTimeline for input that isn't an on-device Timeline export. */
export class TimelineFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineFormatError';
  }
}

/**
 * The parsed JSON as a Timeline export, or a TimelineFormatError explaining
 * what it looks like instead. Only the top level is checked.
 */
export function validateTimeline(json: unknown): RawTimeline {
  const expected =
    'Expected the on-device Google Maps Timeline export: a JSON object with a "semanticSegments" list.';
  if (Array.isArray(json)) {
    throw new TimelineFormatError(`This file holds a JSON list, not a Timeline export. ${expected}`);
  }
  if (typeof json !== 'object' || json === null) {
    throw new TimelineFormatError(`This file doesn't hold a JSON object. ${expected}`);
  }
  const obj = json as Record<string, unknown>;
  if (!('semanticSegments' in obj)) {
    if ('locations' in obj) {
      throw new TimelineFormatError(
        'This looks like the old Google Takeout "Records.json" (raw location records), which this tool ' +
          "doesn't read. Export Timeline data from your phone instead (see README, \"How to Get Your Timeline Data\").",
      );
    }
    if ('timelineObjects' in obj) {
      throw new TimelineFormatError(
        'This looks like an old Google Takeout "Semantic Location History" monthly file, which this tool ' +
          "doesn't read. Export Timeline data from your phone instead (see README, \"How to Get Your Timeline Data\").",
      );
    }
    throw new TimelineFormatError(`No "semanticSegments" found. ${expected}`);
  }
  if (!Array.isArray(obj.semanticSegments)) {
    throw new TimelineFormatError(`"semanticSegments" is not a list. ${expected}`);
  }
  if (obj.semanticSegments.length === 0) {
    throw new TimelineFormatError('The export has no timeline segments: there is nothing to show.');
  }
  return json as RawTimeline;
}

/** A night is 20:00 → 08:00 local time */
const NIGHT_BEFORE_MIDNIGHT_MS = 4 * 3_600_000;
const NIGHT_AFTER_MIDNIGHT_MS = 8 * 3_600_000;
/** A "flight" longer than this is a gap-filling artifact (phone off), not a flight */
const MAX_FLIGHT_MS = 20 * 3_600_000;

export async function runPipeline(
  timeline: RawTimeline,
  inputs: PipelineInputs,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const log = options.log ?? (() => {});
  const warn = options.warn ?? (() => {});
  const progress = options.onProgress ?? (() => {});
  const homeMinPeriodMonths = options.homeMinPeriodMonths ?? DEFAULT_HOME_MIN_PERIOD_MONTHS;
  const { airports, familyHomes: familyHomeConfig } = inputs;
  const segments = timeline.semanticSegments;

  // ========================================================================
  // 1. Collect home samples (home periods are detected with the nights, §4)
  // ========================================================================
  progress('visits');
  const homeSamples: HomeSample[] = [];
  for (const s of segments) {
    const st = s.visit?.topCandidate?.semanticType;
    const latLng = s.visit?.topCandidate?.placeLocation?.latLng;
    if ((st === 'INFERRED_HOME' || st === 'HOME') && latLng) {
      const [lat, lng] = parseLatLng(latLng);
      homeSamples.push({ lat, lng, latLng, date: dateStr(localStart(s)) });
    }
  }
  log(`  ${homeSamples.length} HOME / INFERRED_HOME visits`);

  // ========================================================================
  // 2. Extract visits
  // ========================================================================
  log('Extracting visits…');
  interface VisitAccumulator {
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
  const visitMap = new Map<string, VisitAccumulator>();

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
        lastVisit: arrivals[arrivals.length - 1],
        stays: v.stays,
      };
    })
    .sort((a, b) => b.visitCount - a.visitCount);

  log(`  ${visitsBase.length} unique places`);

  progress('cities');
  log('Loading offline city database…');
  const cityResolver = new CityResolver(inputs.cityDb, {
    geocoder: options.geocoder,
    refreshFallbackEntries: options.refreshFallbackEntries,
  });

  log('Prefilling offline city database from timeline locations…');
  await cityResolver.prefill(
    visitsBase.map((v) => ({ lat: v.lat, lng: v.lng })),
    (done, total) => {
      log(`  City DB prefill: ${done}/${total}`);
      progress('cities', `${done}/${total}`);
    },
  );

  // The raw Timeline export carries no human-readable place name (only
  // placeId + coordinates), so resolve each visit's city/country via the
  // same offline city DB used elsewhere. The prefill step above already
  // populated the resolver's cache for every visit coordinate, so these
  // are cache hits — no additional online lookups are triggered here.
  log('Resolving place names for visits…');
  const visits: Visit[] = [];
  for (const v of visitsBase) {
    const resolved = await cityResolver.resolve(v.lat, v.lng);
    visits.push({
      ...v,
      city: resolved?.name,
      country: resolved?.country,
    });
  }

  // ========================================================================
  // 3. Extract flights
  // ========================================================================
  progress('flights');
  log('Extracting flights…');
  log(`  ${airports.length} airports loaded for nearest-airport matching`);
  interface FlightBase {
    date: string;
    startTime: string;
    endTime: string;
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    distanceKm: number;
    durationMin: number;
    path: [number, number][];
  }

  const flights: FlightBase[] = [];
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
  const enrichedFlights: Flight[] = [];
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

  log(`  ${enrichedFlights.length} flights found`);

  const fullyMatched = enrichedFlights.filter((f) => f.startAirport && f.endAirport);
  const unmatchedFlights = enrichedFlights.filter((f) => !f.startAirport || !f.endAirport);
  log(
    `  Airport match: ${fullyMatched.length}/${enrichedFlights.length} flights matched at both ends ` +
      `(${Math.round((fullyMatched.length / (enrichedFlights.length || 1)) * 100)}%)`,
  );
  if (unmatchedFlights.length > 0) {
    log('  Unmatched flight endpoints:');
    for (const f of unmatchedFlights) {
      const endpoint = (airport: MatchedAirport | null | undefined, lat: number, lng: number) =>
        airport ? airport.iata : `no match (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
      log(
        `    ${f.date}: ${endpoint(f.startAirport, f.startLat, f.startLng)} → ` +
          `${endpoint(f.endAirport, f.endLat, f.endLng)}`,
      );
    }
  }
  const totalCo2Kg = enrichedFlights.reduce((sum, f) => sum + (f.co2Kg ?? 0), 0);
  log(`  Total estimated CO2 (all flights, all time): ${(totalCo2Kg / 1000).toFixed(1)} t`);

  // ========================================================================
  // 4. Home periods and nights away from home
  // ========================================================================
  progress('nights');
  log('Locating nights…');
  // One night per local date the export covers, keyed by the date of the
  // evening it begins: night D is 20:00 on D to 08:00 on D+1, local time. It
  // was spent at the visit overlapping that window most, each visit judged in
  // its own local time (the UTC offset recorded at its start; a stay spanning
  // a DST change is off by that hour after it, which never moves a date). So
  // a night in San Francisco is the San Francisco evening's date and hours,
  // whatever zone the phone was set to. Home periods are detected from these,
  // then each night is checked against the home of its period
  // (>HOME_RADIUS_KM away = a night away, unless spent at a family home).

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

  progress('homes');
  log('Detecting home periods…');
  // Geocoder names vary ("USA" vs "United States"), so countries are named
  // after the world geometry when they match (here and in geography.json)
  const countryIndex = buildCountryIndex(inputs.countries);

  const homeClusters = clusterHomeSamples(homeSamples, HOME_RADIUS_KM);
  const detected = detectHomePeriods(
    nightVisits.map(({ date, visit }) => ({ date, lat: visit?.lat ?? null, lng: visit?.lng ?? null })),
    homeClusters,
    homeMinPeriodMonths,
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
    log(
      `  ${p.start} → ${p.end ?? 'ongoing'}: ${p.city ?? '?'}, ${p.country ?? '?'} ` +
        `(${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}) · ${d.supportMonths} months net, ` +
        `${nightsThere} nights there, ${samples} home-labelled visits`,
    );
  });
  if (homePeriods.length === 0) {
    warn('  No HOME / INFERRED_HOME visits found: every night counts as home.');
  }

  // Family homes, labelled after their city unless the config names them
  // (cache only, like the home periods' names)
  const familyHomes: FamilyHome[] = familyHomeConfig.map((c) => ({
    label: c.label?.trim() || cityResolver.peek(c.lat, c.lng)?.name || 'Family home',
    lat: c.lat,
    lng: c.lng,
    radiusKm: c.radiusKm ?? HOME_RADIUS_KM,
  }));

  const familyNights = new Map<FamilyHome, number>();
  const nightsAway: NightEntry[] = nightVisits.map(({ date, visit }) => {
    // No visit data for this date (or no home at all) — unknown, treat as home
    if (!visit || homePeriods.length === 0) return { date, isHome: true };
    const home = homePeriods[periodIndexForDate(homePeriods, date)];
    const dist = haversineDist(home.lat, home.lng, visit.lat, visit.lng);
    const atHome = dist < HOME_RADIUS_KM;
    const family = atHome ? null : familyHomeAt(familyHomes, visit.lat, visit.lng);
    if (family) familyNights.set(family, (familyNights.get(family) ?? 0) + 1);
    return {
      date,
      isHome: atHome || family !== null,
      ...(family ? { family: family.label } : {}),
      lat: visit.lat,
      lng: visit.lng,
      distKm: Math.round(dist * 10) / 10,
      placeId: visit.placeId,
    };
  });

  // A night with no visit defaulted to home above — right for the common case
  // (sparse early data, phone off at home), but mid-trip it is a tracking gap
  // (an overnight bus, a dead phone abroad), and the phantom home night would
  // split the trip in two. When the nearest located nights on both sides are
  // away, the gap nights were spent away too: carry the previous located
  // night's place forward (never backward — its coordinates have then already
  // been through the CityResolver, so resolution order is unchanged), with
  // distKm re-measured against the gap night's own period home. A located
  // home or family night on either side keeps the default: coming home for a
  // night must still end the trip.
  let filledGapNights = 0;
  let prevLocated = -1;
  for (let i = 0; i < nightsAway.length; i++) {
    if (nightsAway[i].lat === undefined) continue;
    if (prevLocated >= 0 && i > prevLocated + 1 && !nightsAway[prevLocated].isHome && !nightsAway[i].isHome) {
      const from = nightsAway[prevLocated];
      for (let j = prevLocated + 1; j < i; j++) {
        const date = nightsAway[j].date;
        const home = homePeriods[periodIndexForDate(homePeriods, date)];
        nightsAway[j] = {
          date,
          isHome: false,
          lat: from.lat!,
          lng: from.lng!,
          distKm: Math.round(haversineDist(home.lat, home.lng, from.lat!, from.lng!) * 10) / 10,
          placeId: from.placeId,
        };
        filledGapNights++;
      }
    }
    prevLocated = i;
  }
  if (filledGapNights > 0) {
    log(`  ${filledGapNights} unlocated nights between away nights counted at the last known place`);
  }

  const totalAway = nightsAway.filter((n) => !n.isHome).length;
  const totalFamily = nightsAway.filter((n) => n.family).length;
  log(
    `  ${nightsAway.length} nights tracked, ${totalAway} away from home` +
      (familyHomes.length > 0 ? `, ${totalFamily} at family homes` : ''),
  );
  for (const h of familyHomes) {
    log(
      `  Family home ${h.label} (${h.lat.toFixed(4)}, ${h.lng.toFixed(4)}, within ${h.radiusKm} km): ` +
        `${familyNights.get(h) ?? 0} nights not counted as away`,
    );
  }

  // ========================================================================
  // 5. Geography: countries, away-night cities, and days present
  // ========================================================================
  // Emitted per night and per date (not as totals) so the frontend can rank
  // countries and cities, and shade the world map, for any selected range.
  progress('geography');
  log('Resolving geography…');

  // Countries are keyed by ISO code (countryIndex, built in §4) so name
  // variants merge, and named after the world geometry when they match.
  const geoCountries: GeographyData['countries'] = [];
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

  const geoCities: GeographyData['cities'] = [];
  const geoCityIndex = new Map<string, number>();
  const geoNights: GeographyData['nights'] = [];

  for (const night of nightsAway) {
    if (night.isHome) continue; // family-home nights included: they aren't away

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
    warn(`  No map geometry for: ${unmappedCountries.join(', ')} (add them to COUNTRY_ALIASES)`);
  }

  const geography: GeographyData = {
    countries: geoCountries,
    cities: geoCities,
    nights: geoNights,
    presence,
  };

  log(
    `  ${geoCountries.length} countries (${geoCountries.length - unmappedCountries.length} on the map), ` +
      `${geoCities.length} cities matched, ${presence.length} days with a known country`,
  );

  // ========================================================================
  // 6. Group into trips
  // ========================================================================
  progress('trips');
  log('Grouping trips…');
  // A trip is a run of consecutive away nights. Family-home nights are isHome
  // too, so like nights at home they never start or extend a trip: a stay at a
  // family home is no trip at all, and a trip with a family-home stopover in
  // the middle splits into the parts before and after it.
  function toTrip(tripNights: NightEntry[]): Trip {
    const placeCount = new Map<string, { lat: number; lng: number; nights: number }>();
    let maxDist = 0;
    for (const n of tripNights) {
      if (n.placeId) {
        const existing = placeCount.get(n.placeId);
        if (existing) existing.nights++;
        else placeCount.set(n.placeId, { lat: n.lat!, lng: n.lng!, nights: 1 });
      }
      if (n.distKm && n.distKm > maxDist) maxDist = n.distKm;
    }
    return {
      startDate: tripNights[0].date,
      endDate: tripNights[tripNights.length - 1].date,
      nights: tripNights.length,
      places: [...placeCount.entries()].map(([placeId, p]) => ({ placeId, ...p })),
      maxDistKm: Math.round(maxDist),
    };
  }

  const trips: Trip[] = [];
  let tripStart = -1;
  for (let i = 0; i < nightsAway.length; i++) {
    if (!nightsAway[i].isHome) {
      if (tripStart === -1) tripStart = i;
    } else if (tripStart !== -1) {
      trips.push(toTrip(nightsAway.slice(tripStart, i)));
      tripStart = -1;
    }
  }
  // A trip still going on at the end of the export
  if (tripStart !== -1) trips.push(toTrip(nightsAway.slice(tripStart)));

  log(`  ${trips.length} trips detected`);

  // ========================================================================
  // 7. Activity log for statistics
  // ========================================================================
  // One row per activity segment, stored column-wise to keep the file small.
  // The frontend aggregates the rows inside the selected time range into
  // distance/count/duration by mode, per-period trends, and day-of-week /
  // hour-of-day patterns. Distances stay unrounded so sums are exact.
  progress('activities');
  log('Building activity log…');

  const modes: string[] = [];
  const modeIndex = new Map<string, number>();
  const activities: Stats['activities'] = {
    date: [],
    hour: [],
    mode: [],
    meters: [],
    seconds: [],
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

  const stats: Stats = {
    // Local, so the date prefixes are the first and last nights' dates
    dateRange: {
      start: localStart(segments[0]),
      end: localEnd(segments[segments.length - 1]),
    },
    modes,
    activities,
  };

  log(`  ${activities.date.length} activities, ${Math.round(totalMeters / 1000).toLocaleString()} km`);

  // ========================================================================
  // 8. Route data for travel map (sampled to keep size manageable)
  // ========================================================================
  progress('routes');
  log('Extracting route data…');

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

  log(`  ${routes.length} route segments`);

  return {
    datasets: {
      home: homePeriods,
      flights: enrichedFlights,
      visits,
      nightsAway,
      familyHomes,
      geography,
      trips,
      routes,
      stats,
    },
    cityStats: cityResolver.getStats(),
  };
}
