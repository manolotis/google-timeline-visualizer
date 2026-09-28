/**
 * Trip detail derivations: which trip a URL names, the dates it covers, and
 * what happened on those dates.
 *
 * A trip from trips.json is used for its dates only. Everything the detail
 * view shows is derived client-side by filtering the per-record datasets to
 * the trip's date windows, the same way aggregate.ts filters them to the
 * global time range, so the view stays right however preprocess groups
 * nights into trips. The global range itself does not apply: a trip is
 * always shown whole.
 */
import type { Flight, GeographyData, NightEntry, RouteSegment, Stats, Trip, TripPlace, Visit } from './types';
import { inRange } from './timeRange';
import { isHomePlace, summarizeActivities, summarizeVisits, type ActivitySummary, type PlaceSummary } from './aggregate';
import { greatCircleArc } from './flight';

const DAY_MS = 86_400_000;

/** '2024-03-14' + 1 → '2024-03-15' (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive, closed date range (assignable to timeRange's DateRange). */
export interface Dates {
  start: string;
  end: string;
}

export interface TripWindows {
  /** Night keys (nights-away.json, geography.json `nights`): first → last away night */
  nights: Dates;
  /** Calendar days of travel, departure → return day (routes, flights, stays, stats, presence) */
  days: Dates;
}

/**
 * Preprocess keys each night by the local date of the evening it begins,
 * wherever you were. So a trip leaves on the date of its first night and
 * gets back the day after its last one, and every per-record date (flights
 * by local departure date, routes, stays, activities, presence) is a local
 * date too. The data agrees: outbound flights fall on the first night's
 * date, return flights on the day after the last night, or on the last
 * night's own date for an evening departure (a night spent flying home
 * counts as away).
 */
export function tripWindows(trip: Trip): TripWindows {
  return {
    nights: { start: trip.startDate, end: trip.endDate },
    days: { start: trip.startDate, end: addDays(trip.endDate, 1) },
  };
}

/**
 * The trip whose first night is `start`, else the one that includes that
 * night (e.g. a link made before a preprocess rerun regrouped trips).
 */
export function findTrip(trips: Trip[], start: string): Trip | null {
  return (
    trips.find((t) => t.startDate === start) ??
    trips.find((t) => t.startDate <= start && start <= t.endDate) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface TripNight {
  date: string;
  isHome: boolean;
  distKm?: number;
  /** Where the night was spent; null if unresolved */
  city: string | null;
  country: string | null;
}

/** Consecutive nights in the same city. */
export interface TripLeg {
  /** First and last night */
  start: string;
  end: string;
  nights: number;
  isHome: boolean;
  city: string | null;
  country: string | null;
  /** Farthest from home during the leg */
  maxDistKm: number | null;
}

export interface TripCity {
  city: string;
  country: string;
  nights: number;
}

export interface TripCountry {
  country: string;
  nights: number;
  /** Days with a recorded visit there during the trip (departure and return days included) */
  daysPresent: number;
}

export interface TripGeography {
  /** Most nights first, then in trip order */
  cities: TripCity[];
  /** Countries with at least one night; most nights first */
  countries: TripCountry[];
  /** Countries visited without staying the night (layovers, day trips), home excluded */
  passedThrough: TripCountry[];
  /** Away nights that didn't resolve to a city */
  unresolvedNights: number;
}

/** A place slept at during the trip, with its resolved name. */
export interface TripStay extends TripPlace {
  city?: string;
  country?: string;
}

export type LatLng = [number, number];

export interface TripSummary {
  windows: TripWindows;
  /** Every night of the trip, in order */
  nights: TripNight[];
  legs: TripLeg[];
  /** null when geography.json is missing or stale */
  geography: TripGeography | null;
  /** Flights during the trip, in order */
  flights: Flight[];
  /** Great-circle arc per flight (same order) */
  flightArcs: LatLng[][];
  /** Ground movement to draw: routes of known, non-flying modes (flights are arcs) */
  routes: RouteSegment[];
  /** Where the nights were spent, most nights first */
  stays: TripStay[];
  /** Other places visited: non-home places with a stay during the trip, minus the `stays` */
  places: PlaceSummary[];
  /** Distinct non-home places visited, stays included */
  placeCount: number;
  /** Distance and time per mode during the trip (stats.json) */
  activity: ActivitySummary;
  /** Home before the trip (the last not-away night with coordinates), for the map */
  home: LatLng | null;
  /** Label of the family home the trip left from, when `home` is one */
  homeFamily: string | null;
  /** Label of the family home the trip ended at (the night after it), if any */
  returnFamily: string | null;
  /** Bounding box of everything drawn for the trip, home excluded; null if nothing */
  bounds: [LatLng, LatLng] | null;
}

export interface TripData {
  nights: NightEntry[];
  flights: Flight[];
  routes: RouteSegment[];
  visits: Visit[];
  stats: Stats;
  /** null when missing or stale */
  geo: GeographyData | null;
}

const MAP_EXCLUDED_MODES = new Set(['FLYING', 'UNKNOWN_ACTIVITY_TYPE']);

export function summarizeTrip(trip: Trip, data: TripData): TripSummary {
  const windows = tripWindows(trip);
  const visitsById = new Map(data.visits.map((v) => [v.placeId, v]));

  const cityOfNight = new Map<string, { city: string; country: string }>();
  if (data.geo) {
    for (const night of data.geo.nights) {
      if (night.city === null || !inRange(night.date, windows.nights)) continue;
      const { city, country } = data.geo.cities[night.city];
      cityOfNight.set(night.date, { city, country: data.geo.countries[country].country });
    }
  }

  // Nights: where each was spent (geography's city for the night, else the
  // slept-at place's resolved name), consecutive ones in one city as a leg
  const nights: TripNight[] = [];
  const legs: TripLeg[] = [];
  const stayById = new Map<string, TripStay>();
  // The last night before the trip that was verifiably at home, or at a
  // family home (nights without any visit data default to home but carry no
  // coordinates), and whether the trip ended at a family home
  let home: LatLng | null = null;
  let homeDate: string | null = null;
  let homeFamily: string | null = null;
  let returnFamily: string | null = null;
  let legKey = '';
  for (const n of data.nights) {
    if (n.date < windows.nights.start) {
      if (n.isHome && n.lat != null && n.lng != null) {
        home = [n.lat, n.lng];
        homeDate = n.date;
        homeFamily = n.family ?? null;
      }
      continue;
    }
    if (n.date > windows.nights.end) {
      returnFamily = n.family ?? null;
      break;
    }

    const visit = n.placeId ? visitsById.get(n.placeId) : undefined;
    const named = n.isHome ? undefined : cityOfNight.get(n.date);
    const city = named?.city ?? visit?.city ?? null;
    const country = named?.country ?? visit?.country ?? null;
    nights.push({ date: n.date, isHome: n.isHome, distKm: n.distKm, city, country });

    const key = n.isHome ? 'home' : city !== null ? `${city}|${country}` : `?${n.placeId ?? ''}`;
    const last = legs[legs.length - 1];
    if (last && key === legKey) {
      last.end = n.date;
      last.nights++;
      if (n.distKm != null) last.maxDistKm = Math.max(last.maxDistKm ?? 0, n.distKm);
    } else {
      legs.push({
        start: n.date,
        end: n.date,
        nights: 1,
        isHome: n.isHome,
        city,
        country,
        maxDistKm: n.distKm ?? null,
      });
      legKey = key;
    }

    if (!n.isHome && n.placeId && n.lat != null && n.lng != null) {
      const stay = stayById.get(n.placeId);
      if (stay) stay.nights++;
      else {
        stayById.set(n.placeId, {
          placeId: n.placeId,
          lat: n.lat,
          lng: n.lng,
          nights: 1,
          city: visit?.city,
          country: visit?.country,
        });
      }
    }
  }
  const stays = [...stayById.values()].sort((a, b) => b.nights - a.nights);

  // Each time is in its own place's UTC offset, so order by instant, not by string
  const flights = data.flights
    .filter((f) => inRange(f.date, windows.days))
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  const flightArcs = flights.map((f) => greatCircleArc(f.startLat, f.startLng, f.endLat, f.endLng));

  const routes = data.routes.filter(
    (r) => !MAP_EXCLUDED_MODES.has(r.mode) && inRange(r.startTime.slice(0, 10), windows.days),
  );

  const visited = summarizeVisits(data.visits, windows.days).places.filter(
    (p) => !isHomePlace(p.semanticType),
  );
  const places = visited.filter((p) => !stayById.has(p.placeId));

  return {
    windows,
    nights,
    legs,
    geography: data.geo ? tripGeography(data.geo, windows, homeDate) : null,
    flights,
    flightArcs,
    routes,
    stays,
    places,
    placeCount: visited.length,
    activity: summarizeActivities(data.stats, windows.days),
    home,
    homeFamily,
    returnFamily,
    bounds: boundsOf([
      ...routes.flatMap((r) => r.points),
      ...flightArcs.flat(),
      ...stays.map((s): LatLng => [s.lat, s.lng]),
      ...places.map((p): LatLng => [p.lat, p.lng]),
    ]),
  };
}

/** `homeDate`: a date spent at (family) home before the trip, whose countries aren't "passed through". */
function tripGeography(
  geo: GeographyData,
  windows: TripWindows,
  homeDate: string | null,
): TripGeography {
  const cityNights = new Map<number, number>();
  let unresolvedNights = 0;
  for (const night of geo.nights) {
    if (!inRange(night.date, windows.nights)) continue;
    if (night.city === null) unresolvedNights++;
    else cityNights.set(night.city, (cityNights.get(night.city) ?? 0) + 1);
  }

  const countryNights = new Map<number, number>();
  for (const [city, nights] of cityNights) {
    const country = geo.cities[city].country;
    countryNights.set(country, (countryNights.get(country) ?? 0) + nights);
  }

  // Days present during the trip (departure and return days included, so
  // layovers count), minus the home country, present on those days too
  const daysPresent = new Map<number, number>();
  let homeCountries: number[] = [];
  for (const [date, present] of geo.presence) {
    if (date === homeDate) homeCountries = present;
    if (date < windows.days.start) continue;
    if (date > windows.days.end) break; // sorted by date
    for (const country of present) daysPresent.set(country, (daysPresent.get(country) ?? 0) + 1);
  }

  const country = (index: number): TripCountry => ({
    country: geo.countries[index].country,
    nights: countryNights.get(index) ?? 0,
    daysPresent: daysPresent.get(index) ?? 0,
  });

  // Stable sorts: ties stay in trip order (Map insertion order)
  return {
    cities: [...cityNights]
      .map(([index, nights]) => ({
        city: geo.cities[index].city,
        country: geo.countries[geo.cities[index].country].country,
        nights,
      }))
      .sort((a, b) => b.nights - a.nights),
    countries: [...countryNights.keys()]
      .map(country)
      .sort((a, b) => b.nights - a.nights || b.daysPresent - a.daysPresent),
    passedThrough: [...daysPresent.keys()]
      .filter((index) => !countryNights.has(index) && !homeCountries.includes(index))
      .map(country)
      .sort((a, b) => b.daysPresent - a.daysPresent),
    unresolvedNights,
  };
}

function boundsOf(points: LatLng[]): [LatLng, LatLng] | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [[minLat, minLng], [maxLat, maxLng]];
}
