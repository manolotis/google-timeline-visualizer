/**
 * Command-line preprocessing of Google Maps Timeline data.
 *
 * A thin Node wrapper around the shared pipeline in src/pipeline/ (the same
 * code the in-browser import runs in a Web Worker). This script does the
 * parts that need Node:
 *
 *   - reads Timeline.json, the optional timeline-config.json (family homes),
 *     and the committed reference data: scripts/data/offline-city-db.json,
 *     scripts/data/airports.json and public/world-countries.geo.json
 *   - reads the tuning environment variables (CITY_DB_*, HOME_MIN_PERIOD_MONTHS)
 *   - plugs in the optional online Nominatim lookups (scripts/nominatim.ts)
 *   - writes the datasets to public/data/*.json and the grown offline city
 *     DB back to scripts/data/offline-city-db.json
 *
 * Generated files (see DATASET_FILES and the types in src/pipeline/types.ts):
 *   - home.json        — Home periods over time (where you lived, and when),
 *                        detected from HOME / INFERRED_HOME visits and nights
 *   - flights.json     — Flight segments with coords, distance, duration, and paths
 *   - visits.json      — Deduplicated places with counts, time spent, and dated stays
 *   - nights-away.json — Per-date home/away classification against the home
 *                        period active that night (plus family-home nights)
 *   - family-homes.json — The family homes configured in timeline-config.json
 *   - geography.json   — Countries (with ISO codes matched against
 *                        public/world-countries.geo.json), the city of every
 *                        away night, and the countries present on every date
 *   - trips.json       — Consecutive away-nights grouped into trips
 *   - routes.json      — All activity segments with polyline paths (downsampled)
 *   - stats.json       — Column-oriented log of every activity (date, hour, mode,
 *                        distance, duration) for client-side aggregation
 *
 * Usage: npm run preprocess
 */
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import {
  DATASET_FILES,
  DATASET_KEYS,
  DEFAULT_CITY_BUCKET_DEG,
  DEFAULT_HOME_MIN_PERIOD_MONTHS,
  buildCityDb,
  parseTimelineConfig,
  runPipeline,
  serializeCityDb,
  validateTimeline,
  type AirportEntry,
  type FamilyHomeConfig,
  type OfflineCityDbFile,
  type WorldCountryNames,
} from '../src/pipeline/index.ts';
import { NominatimGeocoder } from './nominatim.ts';

const ENV = process.env;

function loadAirports(filePath: string): AirportEntry[] {
  if (!fs.existsSync(filePath)) {
    console.warn(
      `  Airport data not found at ${filePath}; flights won't get airport names/CO2. ` +
        'Run: npx tsx scripts/generate-airports.ts',
    );
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AirportEntry[];
}

/**
 * The family homes configured in `configPath`, or none when the file doesn't
 * exist. A malformed file fails the run rather than quietly counting every
 * stay there as away.
 */
function readFamilyHomeConfig(configPath: string): FamilyHomeConfig[] {
  if (!fs.existsSync(configPath)) return [];
  return parseTimelineConfig(
    fs.readFileSync(configPath, 'utf-8'),
    path.basename(configPath),
    (message) => console.warn(message),
  );
}

/** The parsed offline city DB file; null (seed cities only) when missing or unreadable. */
function readOfflineCityDb(dbPath: string): OfflineCityDbFile | null {
  if (!fs.existsSync(dbPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf-8')) as OfflineCityDbFile;
  } catch (err) {
    console.warn('Could not parse offline city DB, continuing with seed cities only.', err);
    return null;
  }
}

/** The world geometry's country names; none (so no ISO codes) when the file is missing. */
function readWorldCountryNames(geoPath: string): WorldCountryNames[] {
  if (!fs.existsSync(geoPath)) {
    console.warn(`  World geometry not found at ${geoPath}; countries get no ISO codes.`);
    return [];
  }
  const { features } = JSON.parse(fs.readFileSync(geoPath, 'utf-8')) as {
    features: { properties: WorldCountryNames }[];
  };
  return features.map((f) => f.properties);
}

async function main() {
  const ROOT = path.resolve('.');
  const RAW = path.join(ROOT, 'Timeline.json');
  const OUT = path.join(ROOT, 'public', 'data');
  const CITY_DB_PATH = path.join(ROOT, 'scripts', 'data', 'offline-city-db.json');
  const WORLD_GEO_PATH = path.join(ROOT, 'public', 'world-countries.geo.json');
  const AIRPORTS_PATH = path.join(ROOT, 'scripts', 'data', 'airports.json');
  const CONFIG_PATH = path.join(ROOT, 'timeline-config.json');

  const CITY_BUCKET_DEG = Number(ENV.CITY_DB_BUCKET_DEG ?? String(DEFAULT_CITY_BUCKET_DEG));
  const CITY_ONLINE_ENABLED = (ENV.CITY_DB_ENABLE_ONLINE ?? '1') !== '0';
  const CITY_MAX_ONLINE = Number(ENV.CITY_DB_MAX_ONLINE_LOOKUPS ?? '80');
  const CITY_TIMEOUT_MS = Number(ENV.CITY_DB_ONLINE_TIMEOUT_MS ?? '4000');
  // Nominatim usage policy allows at most 1 request per second
  const CITY_RPS = Number(ENV.CITY_DB_ONLINE_RPS ?? '1');
  const CITY_REFRESH_FALLBACK =
    (ENV.CITY_DB_REFRESH_FALLBACK ?? '1') !== '0';
  const CITY_USER_AGENT =
    ENV.CITY_DB_USER_AGENT ??
    'timeline-visualizer/1.0 (offline-db-auto-update)';
  // A home must be where you slept most for this many months (net, see
  // detectHomePeriods in src/pipeline/homes.ts)
  const envMinMonths = parseInt(ENV.HOME_MIN_PERIOD_MONTHS ?? '', 10);
  const HOME_MIN_PERIOD_MONTHS = envMinMonths >= 1 ? envMinMonths : DEFAULT_HOME_MIN_PERIOD_MONTHS;

  // Read the config first, so a mistake in it fails before the slow parse below
  const familyHomeConfig = readFamilyHomeConfig(CONFIG_PATH);
  if (familyHomeConfig.length > 0) {
    console.log(`${path.basename(CONFIG_PATH)}: ${familyHomeConfig.length} family home(s)`);
  }

  fs.mkdirSync(OUT, { recursive: true });

  console.log('Reading Timeline.json…');
  const raw = validateTimeline(JSON.parse(fs.readFileSync(RAW, 'utf-8')));
  console.log(`  ${raw.semanticSegments.length} segments loaded`);

  const cityDb = buildCityDb(readOfflineCityDb(CITY_DB_PATH), CITY_BUCKET_DEG);
  const geocoder = CITY_ONLINE_ENABLED
    ? new NominatimGeocoder({
        maxLookups: CITY_MAX_ONLINE,
        timeoutMs: CITY_TIMEOUT_MS,
        requestsPerSecond: CITY_RPS,
        userAgent: CITY_USER_AGENT,
      })
    : undefined;

  const { datasets, cityStats } = await runPipeline(
    raw,
    {
      cityDb,
      countries: readWorldCountryNames(WORLD_GEO_PATH),
      airports: loadAirports(AIRPORTS_PATH),
      familyHomes: familyHomeConfig,
    },
    {
      homeMinPeriodMonths: HOME_MIN_PERIOD_MONTHS,
      geocoder,
      refreshFallbackEntries: CITY_REFRESH_FALLBACK,
      log: (message) => console.log(message),
      warn: (message) => console.warn(message),
    },
  );

  for (const key of DATASET_KEYS) {
    fs.writeFileSync(path.join(OUT, DATASET_FILES[key]), JSON.stringify(datasets[key]));
  }

  fs.mkdirSync(path.dirname(CITY_DB_PATH), { recursive: true });
  fs.writeFileSync(CITY_DB_PATH, serializeCityDb(cityDb, new Date().toISOString()));
  console.log(
    `Offline city DB updated: ${cityStats.totalEntries} entries ` +
      `(cache: ${cityStats.cacheHits}, online: ${cityStats.onlineHits}, fallback: ${cityStats.fallbackHits}, ` +
      `online lookups used: ${geocoder?.lookupsUsed ?? 0})`,
  );

  console.log('\nDone! Output files in public/data/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
