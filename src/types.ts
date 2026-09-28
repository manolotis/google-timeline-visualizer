/**
 * Shared TypeScript interfaces for all preprocessed data shapes.
 *
 * These types mirror the JSON structure produced by scripts/preprocess.ts
 * and are consumed by the React hooks in hooks/useData.ts. Shapes derived
 * client-side for the selected time range live in aggregate.ts.
 *
 * Dates are 'YYYY-MM-DD' strings. For activities, visits, flights, and
 * routes that is the event-local calendar date (the prefix of the export's
 * ISO timestamp); nights use the night key from nights-away.json.
 */

// Types matching the preprocessed JSON output files

export interface Home {
  lat: number;
  lng: number;
}

export interface Flight {
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
  originPlaceId?: string;
  destPlaceId?: string;
  startCity?: string;
  startCountry?: string;
  endCity?: string;
  endCountry?: string;
}

export interface Visit {
  placeId: string;
  lat: number;
  lng: number;
  semanticType: string;
  visitCount: number;
  totalHours: number;
  firstVisit: string;
  lastVisit: string;
  /** Every stay at this place: [start date, duration in seconds] */
  stays: [string, number][];
}

export interface NightEntry {
  date: string;
  isHome: boolean;
  lat?: number;
  lng?: number;
  distKm?: number;
  placeId?: string;
}

/** geography.json */
export interface GeographyData {
  /** Distinct cities that away nights resolved to */
  cities: { city: string; country: string; lat: number; lng: number }[];
  /** One entry per away night; `city` indexes `cities` (null = unresolved) */
  nights: { date: string; city: number | null }[];
}

export interface TripPlace {
  placeId: string;
  lat: number;
  lng: number;
  nights: number;
}

export interface Trip {
  startDate: string;
  endDate: string;
  nights: number;
  places: TripPlace[];
  maxDistKm: number;
}

export interface RouteSegment {
  startTime: string;
  mode: string;
  points: [number, number][];
}

/**
 * stats.json — one row per activity (movement) segment, stored column-wise:
 * index i of every `activities` array describes the same activity.
 */
export interface Stats {
  /** ISO timestamps of the first segment's start and the last segment's end */
  dateRange: { start: string; end: string };
  /** Transport mode names; `activities.mode` holds indices into this list */
  modes: string[];
  activities: {
    date: string[];
    /** Event-local start hour, 0–23 */
    hour: number[];
    mode: number[];
    /** Distance in meters, unrounded */
    meters: number[];
    /** Duration in seconds */
    seconds: number[];
  };
}

export type Page = 'overview' | 'flights' | 'nights' | 'map' | 'stats' | 'geography';
