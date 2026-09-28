/**
 * Data shapes of the preprocessing pipeline: the raw Timeline.json export it
 * reads, the reference data it needs, and the datasets it produces.
 *
 * This file is the single source of truth for the generated datasets. The
 * Node CLI (scripts/preprocess.ts) writes them to public/data/*.json, the
 * in-browser import (src/import/) stores the same JSON text in IndexedDB,
 * and the frontend reads them through src/types.ts, which re-exports these
 * types. Change a shape here and both producers and the consumer follow.
 *
 * Dates are 'YYYY-MM-DD' local calendar dates: the date where the user was
 * at the time, from the UTC offsets the export records for every visit and
 * activity (not the phone's time zone). Timestamps are ISO strings written
 * in that local offset (e.g. '2024-12-10T13:35:57.000-08:00'), so their
 * 'YYYY-MM-DD' prefix is the local date and their hour the local hour;
 * compare them with Date.parse, not as strings, since offsets differ. A
 * night is keyed by the local date of the evening it begins.
 *
 * Environment-agnostic like the rest of src/pipeline/: no DOM or Node types.
 */

// ---------------------------------------------------------------------------
// Raw input: the on-device Timeline.json export
// ---------------------------------------------------------------------------

export interface RawSegment {
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

/** Extra top-level keys (rawSignals, userLocationProfile) are ignored. */
export interface RawTimeline {
  semanticSegments: RawSegment[];
}

// ---------------------------------------------------------------------------
// Reference inputs (committed files, plus the optional family-home config)
// ---------------------------------------------------------------------------

/** An entry of scripts/data/airports.json (trimmed OurAirports data). */
export interface AirportEntry {
  iata: string;
  name: string;
  lat: number;
  lng: number;
  municipality: string;
  size: 'large' | 'medium';
}

/** A known city (seed list, or an offline city DB entry). */
export interface CityEntry {
  lat: number;
  lng: number;
  name: string;
  country: string;
}

/** An entry of the offline city DB, keyed by its coordinate bucket. */
export interface ResolvedCity extends CityEntry {
  key: string;
  source: 'seed' | 'online' | 'fallback';
  updatedAt: string;
}

/** scripts/data/offline-city-db.json */
export interface OfflineCityDbFile {
  version: number;
  updatedAt: string;
  entries: ResolvedCity[];
}

/**
 * The name fields of a public/world-countries.geo.json feature, which is all
 * the pipeline needs from the world geometry (to attach ISO codes).
 */
export interface WorldCountryNames {
  iso3: string;
  name: string;
  names?: string[];
}

/** timeline-config.json: every key optional */
export interface TimelineConfig {
  familyHomes?: FamilyHomeConfig[];
}

export interface FamilyHomeConfig {
  lat: number;
  lng: number;
  /** Shown in the dashboard; defaults to the resolved city name */
  label?: string;
  /** Nights within this distance count as spent there; defaults to 1 km (the home radius) */
  radiusKm?: number;
}

// ---------------------------------------------------------------------------
// Output datasets (one JSON file each)
// ---------------------------------------------------------------------------

/**
 * home.json is a list of these, oldest first and non-overlapping: where you
 * lived, and when. Nights outside every period (before the first, or in the
 * gap between two) belong to the nearest period in time, ties to the earlier
 * one — see periodIndexForDate (homes.ts) and homePeriodsInRange
 * (src/aggregate.ts), which must agree.
 */
export interface HomePeriod {
  /** First night slept at this home (night key) */
  start: string;
  /** Last night slept there; null for the current (ongoing) home */
  end: string | null;
  lat: number;
  lng: number;
  /** Resolved from the offline city DB; null if not cached */
  city: string | null;
  country: string | null;
}

/** The airport a flight endpoint was matched to */
export interface MatchedAirport {
  iata: string;
  name: string;
}

/** flights.json is a list of these, in timeline order. */
export interface Flight {
  /** Local departure date */
  date: string;
  /** Local departure time (in the departure's UTC offset) */
  startTime: string;
  /** Local arrival time (in the arrival's UTC offset) */
  endTime: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceKm: number;
  durationMin: number;
  path: [number, number][];
  originPlaceId?: string;
  destPlaceId?: string;
  startCity?: string;
  startCountry?: string;
  endCity?: string;
  endCountry?: string;
  // The pipeline always writes the three fields below; they're optional
  // because data generated before flight extras lacks them, and the frontend
  // must keep handling that.
  /** Nearest airport (within ~40 km) to the departure point; null if none matched */
  startAirport?: MatchedAirport | null;
  /** Nearest airport (within ~40 km) to the arrival point; null if none matched */
  endAirport?: MatchedAirport | null;
  /** Estimated kg CO2e for this flight (great-circle distance + detour, DEFRA-style factor by haul, RF-adjusted; see estimateFlightCo2Kg) */
  co2Kg?: number;
}

/** visits.json is a list of these, most visited first. */
export interface Visit {
  placeId: string;
  lat: number;
  lng: number;
  semanticType: string;
  visitCount: number;
  totalHours: number;
  /** Local arrival timestamps of the first and last stays */
  firstVisit: string;
  lastVisit: string;
  /** Every stay at this place: [local start date, duration in seconds] */
  stays: [string, number][];
  /** Resolved city/country name (offline city DB); absent if unresolved */
  city?: string;
  country?: string;
}

/**
 * family-homes.json: the family homes configured in timeline-config.json
 * (`[]` without one; missing in exports from before family homes). A night
 * spent at one isn't away; see NightEntry.family.
 */
export interface FamilyHome {
  /** From the config, else the resolved city name, else 'Family home' */
  label: string;
  lat: number;
  lng: number;
  /** Nights within this distance of the point count as spent there */
  radiusKm: number;
}

/** nights-away.json is a list of these, one per local date the export covers. */
export interface NightEntry {
  /** The local date of the evening the night begins (20:00 → 08:00 local) */
  date: string;
  /**
   * Not a night away: within 1 km of the home of this night's period, or at a
   * family home (then `family` is set too). True when the night has no
   * location — except a gap between two away nights (a mid-trip tracking
   * loss), which counts as away at the last located night's place.
   */
  isHome: boolean;
  /**
   * Label of the family home (family-homes.json) the night was spent at. Only
   * on nights that would otherwise be away, so never while that place is the
   * period's home. Use isOwnHomeNight (aggregate.ts) for nights at home proper.
   */
  family?: string;
  lat?: number;
  lng?: number;
  /** Distance from the home of this night's period */
  distKm?: number;
  placeId?: string;
}

/** geography.json */
export interface GeographyData {
  /**
   * One entry per country, merged by ISO code so geocoder spellings like
   * "USA" / "United States" are a single country. `iso3` is the ISO 3166-1
   * alpha-3 code of the matching world-countries.geo.json feature (null if
   * unmatched) and `country` that feature's display name (else the raw name).
   */
  countries: { country: string; iso3: string | null }[];
  /** Distinct cities that away nights resolved to; `country` indexes `countries` */
  cities: { city: string; country: number; lat: number; lng: number }[];
  /** One entry per away night; `city` indexes `cities` (null = unresolved) */
  nights: { date: string; city: number | null }[];
  /**
   * Days present, sorted by date: every local calendar date with at least
   * one recorded visit, with the countries (indices into `countries`) visited
   * that day. Home time, day trips and layovers count; a visit spanning
   * several dates counts for each, and a travel day lists both countries.
   */
  presence: [string, number[]][];
}

export interface TripPlace {
  placeId: string;
  lat: number;
  lng: number;
  nights: number;
}

/** trips.json is a list of these: runs of consecutive away nights. */
export interface Trip {
  startDate: string;
  endDate: string;
  nights: number;
  places: TripPlace[];
  maxDistKm: number;
}

/** routes.json is a list of these, one per activity segment. */
export interface RouteSegment {
  /** Local start time */
  startTime: string;
  mode: string;
  /** Polyline, downsampled to at most ~50 points */
  points: [number, number][];
}

/**
 * stats.json — one row per activity (movement) segment, stored column-wise:
 * index i of every `activities` array describes the same activity.
 */
export interface Stats {
  /** Local timestamps of the first segment's start and the last segment's end (the first and last nights' dates) */
  dateRange: { start: string; end: string };
  /** Transport mode names; `activities.mode` holds indices into this list */
  modes: string[];
  activities: {
    date: string[];
    /** Local start hour, 0–23 */
    hour: number[];
    mode: number[];
    /** Distance in meters, unrounded */
    meters: number[];
    /** Duration in seconds */
    seconds: number[];
  };
}

/** Everything the pipeline produces; see DATASET_FILES for the file names. */
export interface Datasets {
  home: HomePeriod[];
  flights: Flight[];
  visits: Visit[];
  nightsAway: NightEntry[];
  familyHomes: FamilyHome[];
  geography: GeographyData;
  trips: Trip[];
  routes: RouteSegment[];
  stats: Stats;
}

export type DatasetKey = keyof Datasets;
