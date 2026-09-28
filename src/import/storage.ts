/**
 * IndexedDB persistence of in-browser imports.
 *
 * Database 'timeline-visualizer' (version 1) with two object stores:
 *   - 'datasets': every dataset's JSON text, keyed by DatasetKey. Stored as
 *     text (not objects) so reading one back is exactly like fetching its
 *     public/data/ file, and cheap to clone.
 *   - 'meta': the ImportMeta under 'import', and the timeline-config.json
 *     text used for the import (family homes) under 'config'.
 *
 * An import is written in one transaction, so a failed save never leaves a
 * mix of old and new datasets. All of it stays in this browser profile;
 * nothing is sent anywhere.
 */
import type { DatasetKey } from '../pipeline/types';
import type { ImportSummary } from './protocol';

const DB_NAME = 'timeline-visualizer';
const DB_VERSION = 1;
const DATASETS = 'datasets';
const META = 'meta';

/**
 * Version of the stored datasets' shapes. Bump it whenever a change to the
 * pipeline's output would break reading an older import: imports with
 * another version are then ignored (the app asks for a re-import).
 */
export const IMPORT_FORMAT_VERSION = 1;

export interface ImportMeta {
  formatVersion: number;
  /** ISO timestamp of the import */
  importedAt: string;
  fileName: string;
  fileSize: number;
  summary: ImportSummary;
  /** Wall-clock duration of the import, reading to saved */
  durationMs: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available in this browser'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DATASETS)) db.createObjectStore(DATASETS);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Let a newer version of the app (another tab) upgrade the database
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab of this app'));
    });
    // Retry on the next call rather than caching a failure
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function readValue<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return requestResult(db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T | undefined>);
}

/** Replaces any previous import with these datasets, meta and config text (null: no config). */
export async function saveImport(
  datasets: Record<DatasetKey, string>,
  meta: ImportMeta,
  configText: string | null,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([DATASETS, META], 'readwrite');
  const done = transactionDone(tx);
  const datasetStore = tx.objectStore(DATASETS);
  datasetStore.clear();
  for (const [key, json] of Object.entries(datasets)) datasetStore.put(json, key);
  const metaStore = tx.objectStore(META);
  metaStore.put(meta, 'import');
  if (configText !== null) metaStore.put(configText, 'config');
  else metaStore.delete('config');
  await done;
}

/** The stored import's meta; null when nothing was imported. */
export async function readImportMeta(): Promise<ImportMeta | null> {
  return (await readValue<ImportMeta>(META, 'import')) ?? null;
}

/** A stored dataset's JSON text; undefined when missing. */
export function readDatasetText(key: DatasetKey): Promise<string | undefined> {
  return readValue<string>(DATASETS, key);
}

/** The timeline-config.json text of the stored import; null when it had none. */
export async function readConfigText(): Promise<string | null> {
  return (await readValue<string>(META, 'config')) ?? null;
}

/** Deletes the imported datasets, meta and config from this browser. */
export async function clearImport(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([DATASETS, META], 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(DATASETS).clear();
  tx.objectStore(META).clear();
  await done;
}
