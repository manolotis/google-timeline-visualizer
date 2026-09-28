/**
 * Shared TypeScript interfaces for all preprocessed data shapes.
 *
 * These types mirror the JSON structure produced by scripts/preprocess.ts
 * and are consumed by the React hooks in hooks/useData.ts.
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
  city?: string;
  country?: string;
}

export interface NightEntry {
  date: string;
  isHome: boolean;
  lat?: number;
  lng?: number;
  distKm?: number;
  placeId?: string;
}

export interface GeographyCountry {
  country: string;
  days: number;
  shareOfAwayDays: number;
}

export interface GeographyCity {
  city: string;
  country: string;
  lat: number;
  lng: number;
  days: number;
  shareOfAwayDays: number;
}

export interface GeographySummary {
  totalAwayDays: number;
  totalCountries: number;
  totalCities: number;
  matchedCountryDays: number;
  matchedCityDays: number;
  unmatchedCountryDays: number;
  unmatchedCityDays: number;
  topCountry: GeographyCountry | null;
  topCity: GeographyCity | null;
}

export interface GeographyStats {
  summary: GeographySummary;
  countries: GeographyCountry[];
  cities: GeographyCity[];
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

export interface YearStats {
  year: number;
  flights: number;
  nightsAway: number;
  totalDistKm: number;
  uniquePlaces: number;
}

export interface TopPlace {
  placeId: string;
  lat: number;
  lng: number;
  visitCount: number;
  totalHours: number;
  semanticType: string;
  city?: string;
  country?: string;
}

export interface Stats {
  totalSegments: number;
  totalFlights: number;
  totalNightsAway: number;
  totalNightsTracked: number;
  totalTrips: number;
  totalUniqueVisitedPlaces: number;
  totalDistanceKm: number;
  totalFlightDistanceKm: number;
  totalWalkingKm: number;
  totalCyclingKm: number;
  distanceByMode: Record<string, number>;
  countByMode: Record<string, number>;
  durationByMode: Record<string, number>;
  totalWalkingHours: number;
  totalCyclingHours: number;
  yearly: YearStats[];
  topPlaces: TopPlace[];
  dayOfWeek: number[];
  hourOfDay: number[];
  dateRange: { start: string; end: string };
  longestTrip: Trip | null;
  furthestTrip: Trip | null;
}

export type Page = 'overview' | 'flights' | 'nights' | 'map' | 'stats' | 'geography';
