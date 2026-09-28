/**
 * Data hooks for the generated datasets.
 *
 * Datasets come from one of two sources, chosen once per load:
 *   - 'imported': an in-browser import stored in IndexedDB (src/import/),
 *     whenever one exists — the most recent import wins over public/data/
 *   - 'static': the files `npm run preprocess` writes to public/data/,
 *     fetched from /data/
 * Both hold the same JSON text, so every hook parses exactly what the CLI
 * would have written. The vendored world geometry is always fetched from
 * the public root.
 *
 * Each hook returns { data, loading, error }. Loads are cached at module
 * level so switching pages (which unmounts them) doesn't reload the
 * multi-megabyte datasets; failed loads are evicted so a later mount
 * retries. reloadData() (after an import, or clearing one) drops the cache
 * and the chosen source, and every mounted hook loads again.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DATASET_FILES, DATASET_KEYS } from '../pipeline/datasets';
import { IMPORT_FORMAT_VERSION, readDatasetText, readImportMeta, type ImportMeta } from '../import/storage';
import type { DatasetKey, Datasets, WorldCountries } from '../types';

export type DataSource =
  | { kind: 'imported'; meta: ImportMeta }
  /** `staleImport`: an import exists but predates the current data format, so it's ignored */
  | { kind: 'static'; staleImport: boolean };

let sourcePromise: Promise<DataSource> | null = null;

/** Where the datasets come from (cached until reloadData). */
export function loadDataSource(): Promise<DataSource> {
  if (!sourcePromise) {
    sourcePromise = readImportMeta().then(
      (meta): DataSource =>
        meta && meta.formatVersion === IMPORT_FORMAT_VERSION
          ? { kind: 'imported', meta }
          : { kind: 'static', staleImport: meta !== null },
      // No usable IndexedDB (e.g. blocked by the browser): public/data only
      (): DataSource => ({ kind: 'static', staleImport: false }),
    );
  }
  return sourcePromise;
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const datasetCache = new Map<DatasetKey, Promise<unknown>>();

function loadDataset(key: DatasetKey): Promise<unknown> {
  let promise = datasetCache.get(key);
  if (!promise) {
    const file = DATASET_FILES[key];
    const loading = loadDataSource().then(async (source) => {
      if (source.kind === 'static') return fetchJson(`/data/${file}`);
      const text = await readDatasetText(key);
      if (text === undefined) throw new Error(`${file} is missing from the imported data`);
      return JSON.parse(text) as unknown;
    });
    // Drop failed loads from the cache so a remount can retry
    loading.catch(() => {
      if (datasetCache.get(key) === loading) datasetCache.delete(key);
    });
    datasetCache.set(key, loading);
    promise = loading;
  }
  return promise;
}

let worldPromise: Promise<unknown> | null = null;

function loadWorld(): Promise<unknown> {
  if (!worldPromise) {
    const loading = fetchJson('/world-countries.geo.json');
    loading.catch(() => {
      if (worldPromise === loading) worldPromise = null;
    });
    worldPromise = loading;
  }
  return worldPromise;
}

// Data generation: bumped by reloadData so mounted hooks load again
let dataVersion = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useDataVersion(): number {
  return useSyncExternalStore(subscribe, () => dataVersion);
}

/**
 * Forget every loaded dataset and the data source; mounted hooks reload
 * (showing `loading` meanwhile). Call after an import is saved or cleared.
 */
export function reloadData(): void {
  datasetCache.clear();
  sourcePromise = null;
  dataVersion++;
  for (const listener of listeners) listener();
}

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface Loaded {
  version: number;
  data: unknown;
  error: string | null;
}

/**
 * Runs `load` (a stable, module-level loader) once per data version; results
 * of an older version read as loading.
 */
function useLoad<T>(load: () => Promise<unknown>): FetchState<T> {
  const version = useDataVersion();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setLoaded({ version, data, error: null });
      },
      (e: Error) => {
        if (!cancelled) setLoaded({ version, data: null, error: e.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, version]);

  const current = loaded?.version === version ? loaded : null;
  return {
    data: (current?.data as T | null | undefined) ?? null,
    loading: current === null,
    error: current?.error ?? null,
  };
}

/** One stable loader per dataset, for useLoad's effect dependencies */
const datasetLoaders = Object.fromEntries(
  DATASET_KEYS.map((key) => [key, () => loadDataset(key)]),
) as Record<DatasetKey, () => Promise<unknown>>;

function useDataset<K extends DatasetKey>(key: K): FetchState<Datasets[K]> {
  return useLoad<Datasets[K]>(datasetLoaders[key]);
}

/** The current data source; null while it's being determined. */
export function useDataSource(): DataSource | null {
  return useLoad<DataSource>(loadDataSource).data;
}

export function useStats() {
  return useDataset('stats');
}

export function useFlights() {
  return useDataset('flights');
}

export function useNightsAway() {
  return useDataset('nightsAway');
}

export function useTrips() {
  return useDataset('trips');
}

export function useVisits() {
  return useDataset('visits');
}

/** Check the result with isStaleHome: older exports wrote a single {lat, lng}. */
export function useHomePeriods() {
  return useDataset('home');
}

/**
 * Exports from before family homes have no family-homes.json: the fetch then
 * fails, which means no family homes (their nights carry no `family` either).
 */
export function useFamilyHomes() {
  return useDataset('familyHomes');
}

export function useRoutes() {
  return useDataset('routes');
}

export function useGeography() {
  return useDataset('geography');
}

export function useWorldCountries() {
  return useLoad<WorldCountries>(loadWorld);
}
