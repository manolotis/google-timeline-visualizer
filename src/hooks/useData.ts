/**
 * Data-fetching hooks for the preprocessed JSON files.
 *
 * Each hook loads its corresponding file from /data/ and returns
 * { data, loading, error } state. Responses are cached at module level so
 * switching between pages (which unmounts them) does not refetch the
 * multi-megabyte JSON files.
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

const cache = new Map<string, Promise<unknown>>();

function fetchJson(url: string): Promise<unknown> {
  let promise = cache.get(url);
  if (!promise) {
    promise = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    });
    // Drop failed fetches from the cache so a reload can retry
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return promise;
}

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetch<T>(url: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetchJson(url)
      .then((d) => {
        if (!cancelled) setState({ data: d as T, loading: false, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: e.message });
      });
    return () => { cancelled = true; };
  }, [url]);

  return state;
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
