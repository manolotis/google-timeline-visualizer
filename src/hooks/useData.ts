/**
 * Data-fetching hooks for the preprocessed JSON files.
 *
 * Each hook lazily loads its corresponding file from /data/ on first render
 * and returns { data, loading } state. The generic useFetch helper handles
 * caching via React state and cleanup on unmount.
 */
import { useState, useEffect } from 'react';
import type {
  Stats,
  Flight,
  NightEntry,
  Trip,
  Visit,
  Home,
  RouteSegment,
  GeographyStats,
} from '../types';

function useFetch<T>(url: string): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [url]);

  return { data, loading };
}

export function useStats() {
  return useFetch<Stats>('/data/stats.json');
}

export function useFlights() {
  return useFetch<Flight[]>('/data/flights.json');
}

export function useNightsAway() {
  return useFetch<NightEntry[]>('/data/nights-away.json');
}

export function useTrips() {
  return useFetch<Trip[]>('/data/trips.json');
}

export function useVisits() {
  return useFetch<Visit[]>('/data/visits.json');
}

export function useHome() {
  return useFetch<Home>('/data/home.json');
}

export function useRoutes() {
  return useFetch<RouteSegment[]>('/data/routes.json');
}

export function useGeography() {
  return useFetch<GeographyStats>('/data/geography.json');
}
