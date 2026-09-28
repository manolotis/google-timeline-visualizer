/**
 * In-browser import: a module Web Worker that turns a dropped Timeline.json
 * into the dashboard's datasets, off the main thread.
 *
 * It reads and parses the file, loads the committed reference data (offline
 * city DB and airports as lazily loaded JSON chunks, the world geometry's
 * country names from public/), runs the shared pipeline (src/pipeline/)
 * and posts back every dataset as JSON text — byte for byte what
 * `npm run preprocess` writes to public/data/. Saving to IndexedDB happens
 * on the main thread (importJob.ts).
 *
 * City resolution is offline-only here: no geocoder is plugged in, so the
 * browser never sends coordinates anywhere (unresolved places fall back to
 * the nearest known city, as in an offline CLI run). Created per import by
 * importJob.ts and terminated when it's done.
 */
import {
  DATASET_KEYS,
  TimelineFormatError,
  buildCityDb,
  runPipeline,
  validateTimeline,
  type AirportEntry,
  type DatasetKey,
  type Datasets,
  type OfflineCityDbFile,
  type RawTimeline,
  type WorldCountryNames,
} from '../pipeline';
import type { ImportErrorKind, ImportPhase, ImportRequest, ImportSummary, WorkerMessage } from './protocol';

/** The dedicated worker scope, typed without the WebWorker lib */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImportRequest>) => void) | null;
  postMessage(message: WorkerMessage): void;
};

/**
 * V8 can't hold a string longer than ~512 M characters, and the whole file
 * is read into one; stay a little below that.
 */
const MAX_FILE_BYTES = 500 * 1024 * 1024;

class ImportError extends Error {
  readonly kind: ImportErrorKind;
  constructor(kind: ImportErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Cheap checks on the first bytes, before reading the whole file. */
async function sniff(file: File): Promise<void> {
  if (file.size === 0) throw new ImportError('format', 'The file is empty.');
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      'memory',
      `This file is ${megabytes(file.size)}, more than a browser can read in one piece (about ` +
        `${megabytes(MAX_FILE_BYTES)}).`,
    );
  }
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    throw new ImportError(
      'format',
      'This is a ZIP archive (for example a Google Takeout download). Extract Timeline.json from it, then import that file.',
    );
  }
  const start = new TextDecoder().decode(head).trimStart();
  if (start && start[0] !== '{' && start[0] !== '[') {
    throw new ImportError(
      'format',
      "This isn't a JSON file. Pick the Timeline.json you exported from Google Maps.",
    );
  }
}

/** Reads and parses the file; its text is garbage once this returns. */
async function readTimeline(file: File, enter: (phase: ImportPhase) => void): Promise<RawTimeline> {
  await sniff(file);
  const text = await file.text();
  enter('parsing');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ImportError(
        'json',
        `This file isn't valid JSON (${err.message}). If it's your Timeline.json, it may be ` +
          'incomplete: export it again, or check that the whole file was copied.',
      );
    }
    throw err;
  }
  return validateTimeline(json);
}

/** The committed reference data the pipeline needs, loaded in parallel with the file. */
async function loadReferenceData(): Promise<{
  cityDbFile: OfflineCityDbFile;
  airports: AirportEntry[];
  countries: WorldCountryNames[];
}> {
  const [cityDbModule, airportsModule, world] = await Promise.all([
    import('../../scripts/data/offline-city-db.json'),
    import('../../scripts/data/airports.json'),
    fetch('/world-countries.geo.json').then((r) => {
      if (!r.ok) throw new Error(`Could not load world-countries.geo.json (${r.status} ${r.statusText})`);
      return r.json() as Promise<{ features: { properties: WorldCountryNames }[] }>;
    }),
  ]);
  return {
    cityDbFile: cityDbModule.default as OfflineCityDbFile,
    airports: airportsModule.default as AirportEntry[],
    countries: world.features.map((f) => f.properties),
  };
}

function summarize(timeline: RawTimeline, datasets: Datasets, familyHomes: number): ImportSummary {
  const nights = datasets.nightsAway;
  return {
    segments: timeline.semanticSegments.length,
    flights: datasets.flights.length,
    nights: nights.length,
    nightsAway: nights.filter((n) => !n.isHome).length,
    trips: datasets.trips.length,
    countries: datasets.geography.countries.length,
    familyHomes,
    firstDate: nights[0]?.date ?? '',
    lastDate: nights[nights.length - 1]?.date ?? '',
  };
}

function describeError(err: unknown): { kind: ImportErrorKind; message: string } {
  if (err instanceof ImportError) return { kind: err.kind, message: err.message };
  if (err instanceof TimelineFormatError) return { kind: 'format', message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (
    (err instanceof RangeError && !/call stack/i.test(message)) ||
    /out of memory|allocation failed|invalid string length/i.test(message)
  ) {
    return {
      kind: 'memory',
      message: `The browser ran out of memory processing this file (${message}). Close other tabs and try again.`,
    };
  }
  if (name === 'NotReadableError' || name === 'NotFoundError') {
    return {
      kind: 'read',
      message: 'The browser could not read the file; it may have been moved or changed since you picked it. Pick it again.',
    };
  }
  return { kind: 'other', message: `Processing failed: ${message}` };
}

async function runImport({ file, familyHomes }: ImportRequest): Promise<void> {
  const timings: Partial<Record<ImportPhase, number>> = {};
  let current: ImportPhase | null = null;
  let phaseStart = 0;
  const enter = (phase: ImportPhase, detail?: string) => {
    const now = performance.now();
    if (phase !== current) {
      if (current) timings[current] = now - phaseStart;
      current = phase;
      phaseStart = now;
    }
    scope.postMessage({ type: 'progress', phase, detail });
  };

  try {
    enter('reading');
    const reference = loadReferenceData();
    // Reported by the await below if the file itself turns out fine
    reference.catch(() => {});
    const timeline = await readTimeline(file, enter);
    const { cityDbFile, airports, countries } = await reference;

    const { datasets } = await runPipeline(
      timeline,
      { cityDb: buildCityDb(cityDbFile), countries, airports, familyHomes },
      { onProgress: enter },
    );

    enter('saving');
    const json = {} as Record<DatasetKey, string>;
    for (const key of DATASET_KEYS) json[key] = JSON.stringify(datasets[key]);
    timings.saving = performance.now() - phaseStart;
    scope.postMessage({
      type: 'done',
      datasets: json,
      summary: summarize(timeline, datasets, familyHomes.length),
      timings,
    });
  } catch (err) {
    scope.postMessage({ type: 'error', ...describeError(err) });
  }
}

scope.onmessage = (event) => {
  void runImport(event.data);
};
