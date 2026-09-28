/**
 * City resolution: coordinates → city and country names, from the offline
 * city DB (scripts/data/offline-city-db.json, committed) plus a small seed
 * list.
 *
 * Resolution order for each location:
 *   1. Exact coordinate bucket hit in the DB
 *   2. An online reverse geocoder, when the caller supplies one (the CLI's
 *      Nominatim client, scripts/nominatim.ts). The pipeline itself never
 *      touches the network, and the in-browser import supplies none.
 *   3. The nearest known city (DB or seed), recorded as a 'fallback' entry
 *
 * Every lookup adds its result to the in-memory DB, so later fallbacks can
 * land on it, and the CLI writes the grown DB back (serializeCityDb). Order
 * of resolution therefore matters for the output: keep resolve() calls in
 * the order runPipeline makes them.
 */
import type { CityEntry, OfflineCityDbFile, ResolvedCity } from './types';
import { haversineDist } from './util';

/** Coordinate bucket (degrees) of the DB keys, unless CITY_DB_BUCKET_DEG says otherwise. */
export const DEFAULT_CITY_BUCKET_DEG = 0.1;

/** Embedded seed cities, always in the DB (DB file entries override them) */
const CITIES: CityEntry[] = [
  // Europe
  { lat: 51.5074, lng: -0.1278, name: 'London', country: 'UK' },
  { lat: 48.8566, lng: 2.3522, name: 'Paris', country: 'France' },
  { lat: 52.5200, lng: 13.4050, name: 'Berlin', country: 'Germany' },
  { lat: 40.4168, lng: -3.7038, name: 'Madrid', country: 'Spain' },
  { lat: 41.3874, lng: 2.1686, name: 'Barcelona', country: 'Spain' },
  { lat: 41.9028, lng: 12.4964, name: 'Rome', country: 'Italy' },
  { lat: 45.4642, lng: 9.1900, name: 'Milan', country: 'Italy' },
  { lat: 52.3676, lng: 4.9041, name: 'Amsterdam', country: 'Netherlands' },
  { lat: 50.8503, lng: 4.3517, name: 'Brussels', country: 'Belgium' },
  { lat: 47.3769, lng: 8.5417, name: 'Zurich', country: 'Switzerland' },
  { lat: 46.2044, lng: 6.1432, name: 'Geneva', country: 'Switzerland' },
  { lat: 48.2082, lng: 16.3738, name: 'Vienna', country: 'Austria' },
  { lat: 50.0755, lng: 14.4378, name: 'Prague', country: 'Czech Republic' },
  { lat: 47.4979, lng: 19.0402, name: 'Budapest', country: 'Hungary' },
  { lat: 52.2297, lng: 21.0122, name: 'Warsaw', country: 'Poland' },
  { lat: 59.3293, lng: 18.0686, name: 'Stockholm', country: 'Sweden' },
  { lat: 60.1699, lng: 24.9384, name: 'Helsinki', country: 'Finland' },
  { lat: 59.9139, lng: 10.7522, name: 'Oslo', country: 'Norway' },
  { lat: 55.6761, lng: 12.5683, name: 'Copenhagen', country: 'Denmark' },
  { lat: 38.7223, lng: -9.1393, name: 'Lisbon', country: 'Portugal' },
  { lat: 37.9838, lng: 23.7275, name: 'Athens', country: 'Greece' },
  { lat: 53.3498, lng: -6.2603, name: 'Dublin', country: 'Ireland' },
  { lat: 55.9533, lng: -3.1883, name: 'Edinburgh', country: 'UK' },
  { lat: 53.4808, lng: -2.2426, name: 'Manchester', country: 'UK' },
  { lat: 45.4408, lng: 12.3155, name: 'Venice', country: 'Italy' },
  { lat: 43.7696, lng: 11.2558, name: 'Florence', country: 'Italy' },
  { lat: 40.8518, lng: 14.2681, name: 'Naples', country: 'Italy' },
  { lat: 43.2965, lng: 5.3698, name: 'Marseille', country: 'France' },
  { lat: 43.6047, lng: 1.4442, name: 'Toulouse', country: 'France' },
  { lat: 45.7640, lng: 4.8357, name: 'Lyon', country: 'France' },
  { lat: 53.5511, lng: 9.9937, name: 'Hamburg', country: 'Germany' },
  { lat: 48.1351, lng: 11.5820, name: 'Munich', country: 'Germany' },
  { lat: 50.9375, lng: 6.9603, name: 'Cologne', country: 'Germany' },
  { lat: 50.1109, lng: 8.6821, name: 'Frankfurt', country: 'Germany' },
  { lat: 44.4268, lng: 26.1025, name: 'Bucharest', country: 'Romania' },
  { lat: 42.6977, lng: 23.3219, name: 'Sofia', country: 'Bulgaria' },
  { lat: 44.7866, lng: 20.4489, name: 'Belgrade', country: 'Serbia' },
  { lat: 45.8150, lng: 15.9819, name: 'Zagreb', country: 'Croatia' },
  { lat: 43.8563, lng: 18.4131, name: 'Sarajevo', country: 'Bosnia' },
  { lat: 46.0569, lng: 14.5058, name: 'Ljubljana', country: 'Slovenia' },
  { lat: 64.1466, lng: -21.9426, name: 'Reykjavik', country: 'Iceland' },
  { lat: 36.7213, lng: -4.4214, name: 'Malaga', country: 'Spain' },
  { lat: 39.4699, lng: -0.3763, name: 'Valencia', country: 'Spain' },
  { lat: 37.3891, lng: -5.9845, name: 'Seville', country: 'Spain' },
  { lat: 28.1235, lng: -15.4363, name: 'Gran Canaria', country: 'Spain' },
  { lat: 28.4636, lng: -16.2518, name: 'Tenerife', country: 'Spain' },
  { lat: 39.6131, lng: 2.8882, name: 'Palma de Mallorca', country: 'Spain' },
  { lat: 43.2630, lng: -2.9350, name: 'Bilbao', country: 'Spain' },
  // Americas
  { lat: 40.7128, lng: -74.0060, name: 'New York', country: 'USA' },
  { lat: 34.0522, lng: -118.2437, name: 'Los Angeles', country: 'USA' },
  { lat: 41.8781, lng: -87.6298, name: 'Chicago', country: 'USA' },
  { lat: 37.7749, lng: -122.4194, name: 'San Francisco', country: 'USA' },
  { lat: 25.7617, lng: -80.1918, name: 'Miami', country: 'USA' },
  { lat: 33.4484, lng: -112.0740, name: 'Phoenix', country: 'USA' },
  { lat: 47.6062, lng: -122.3321, name: 'Seattle', country: 'USA' },
  { lat: 38.9072, lng: -77.0369, name: 'Washington DC', country: 'USA' },
  { lat: 42.3601, lng: -71.0589, name: 'Boston', country: 'USA' },
  { lat: 29.7604, lng: -95.3698, name: 'Houston', country: 'USA' },
  { lat: 32.7767, lng: -96.7970, name: 'Dallas', country: 'USA' },
  { lat: 36.1699, lng: -115.1398, name: 'Las Vegas', country: 'USA' },
  { lat: 33.7490, lng: -84.3880, name: 'Atlanta', country: 'USA' },
  { lat: 43.6532, lng: -79.3832, name: 'Toronto', country: 'Canada' },
  { lat: 45.5017, lng: -73.5673, name: 'Montreal', country: 'Canada' },
  { lat: 49.2827, lng: -123.1207, name: 'Vancouver', country: 'Canada' },
  { lat: 19.4326, lng: -99.1332, name: 'Mexico City', country: 'Mexico' },
  { lat: 21.1619, lng: -86.8515, name: 'Cancun', country: 'Mexico' },
  { lat: -23.5505, lng: -46.6333, name: 'São Paulo', country: 'Brazil' },
  { lat: -22.9068, lng: -43.1729, name: 'Rio de Janeiro', country: 'Brazil' },
  { lat: -34.6037, lng: -58.3816, name: 'Buenos Aires', country: 'Argentina' },
  { lat: -33.4489, lng: -70.6693, name: 'Santiago', country: 'Chile' },
  { lat: 4.7110, lng: -74.0721, name: 'Bogota', country: 'Colombia' },
  { lat: -12.0464, lng: -77.0428, name: 'Lima', country: 'Peru' },
  { lat: 10.4806, lng: -66.9036, name: 'Caracas', country: 'Venezuela' },
  { lat: 18.4655, lng: -66.1057, name: 'San Juan', country: 'Puerto Rico' },
  { lat: 9.9281, lng: -84.0907, name: 'San Jose', country: 'Costa Rica' },
  // Middle East
  { lat: 25.2048, lng: 55.2708, name: 'Dubai', country: 'UAE' },
  { lat: 24.4539, lng: 54.3773, name: 'Abu Dhabi', country: 'UAE' },
  { lat: 26.2285, lng: 50.5860, name: 'Manama', country: 'Bahrain' },
  { lat: 25.2854, lng: 51.5310, name: 'Doha', country: 'Qatar' },
  { lat: 41.0082, lng: 28.9784, name: 'Istanbul', country: 'Turkey' },
  { lat: 39.9334, lng: 32.8597, name: 'Ankara', country: 'Turkey' },
  { lat: 36.8969, lng: 30.7133, name: 'Antalya', country: 'Turkey' },
  { lat: 32.0853, lng: 34.7818, name: 'Tel Aviv', country: 'Israel' },
  { lat: 31.7683, lng: 35.2137, name: 'Jerusalem', country: 'Israel' },
  { lat: 30.0444, lng: 31.2357, name: 'Cairo', country: 'Egypt' },
  { lat: 33.8938, lng: 35.5018, name: 'Beirut', country: 'Lebanon' },
  { lat: 31.9454, lng: 35.9284, name: 'Amman', country: 'Jordan' },
  // Asia
  { lat: 35.6762, lng: 139.6503, name: 'Tokyo', country: 'Japan' },
  { lat: 34.6937, lng: 135.5023, name: 'Osaka', country: 'Japan' },
  { lat: 37.5665, lng: 126.9780, name: 'Seoul', country: 'South Korea' },
  { lat: 39.9042, lng: 116.4074, name: 'Beijing', country: 'China' },
  { lat: 31.2304, lng: 121.4737, name: 'Shanghai', country: 'China' },
  { lat: 22.3193, lng: 114.1694, name: 'Hong Kong', country: 'China' },
  { lat: 1.3521, lng: 103.8198, name: 'Singapore', country: 'Singapore' },
  { lat: 13.7563, lng: 100.5018, name: 'Bangkok', country: 'Thailand' },
  { lat: 3.1390, lng: 101.6869, name: 'Kuala Lumpur', country: 'Malaysia' },
  { lat: -6.2088, lng: 106.8456, name: 'Jakarta', country: 'Indonesia' },
  { lat: -8.3405, lng: 115.0920, name: 'Bali', country: 'Indonesia' },
  { lat: 14.5995, lng: 120.9842, name: 'Manila', country: 'Philippines' },
  { lat: 21.0278, lng: 105.8342, name: 'Hanoi', country: 'Vietnam' },
  { lat: 10.8231, lng: 106.6297, name: 'Ho Chi Minh City', country: 'Vietnam' },
  { lat: 28.6139, lng: 77.2090, name: 'New Delhi', country: 'India' },
  { lat: 19.0760, lng: 72.8777, name: 'Mumbai', country: 'India' },
  { lat: 12.9716, lng: 77.5946, name: 'Bangalore', country: 'India' },
  { lat: 22.5726, lng: 88.3639, name: 'Kolkata', country: 'India' },
  { lat: 27.7172, lng: 85.3240, name: 'Kathmandu', country: 'Nepal' },
  { lat: 23.8103, lng: 90.4125, name: 'Dhaka', country: 'Bangladesh' },
  // Africa
  { lat: -33.9249, lng: 18.4241, name: 'Cape Town', country: 'South Africa' },
  { lat: -26.2041, lng: 28.0473, name: 'Johannesburg', country: 'South Africa' },
  { lat: -1.2921, lng: 36.8219, name: 'Nairobi', country: 'Kenya' },
  { lat: 6.5244, lng: 3.3792, name: 'Lagos', country: 'Nigeria' },
  { lat: 33.5731, lng: -7.5898, name: 'Casablanca', country: 'Morocco' },
  { lat: 31.6295, lng: -7.9811, name: 'Marrakech', country: 'Morocco' },
  { lat: 36.8065, lng: 10.1815, name: 'Tunis', country: 'Tunisia' },
  { lat: 9.0250, lng: 38.7469, name: 'Addis Ababa', country: 'Ethiopia' },
  { lat: 14.7167, lng: -17.4677, name: 'Dakar', country: 'Senegal' },
  // Oceania
  { lat: -33.8688, lng: 151.2093, name: 'Sydney', country: 'Australia' },
  { lat: -37.8136, lng: 144.9631, name: 'Melbourne', country: 'Australia' },
  { lat: -27.4698, lng: 153.0251, name: 'Brisbane', country: 'Australia' },
  { lat: -31.9505, lng: 115.8605, name: 'Perth', country: 'Australia' },
  { lat: -36.8485, lng: 174.7633, name: 'Auckland', country: 'New Zealand' },
  { lat: -41.2865, lng: 174.7762, name: 'Wellington', country: 'New Zealand' },
  // Russia / Central Asia
  { lat: 55.7558, lng: 37.6173, name: 'Moscow', country: 'Russia' },
  { lat: 59.9343, lng: 30.3351, name: 'St Petersburg', country: 'Russia' },
  // Caribbean
  { lat: 25.0343, lng: -77.3963, name: 'Nassau', country: 'Bahamas' },
  { lat: 18.9712, lng: -72.2852, name: 'Port-au-Prince', country: 'Haiti' },
  { lat: 18.4861, lng: -69.9312, name: 'Santo Domingo', country: 'Dominican Republic' },
  { lat: 23.1136, lng: -82.3666, name: 'Havana', country: 'Cuba' },
  { lat: 18.1096, lng: -77.2975, name: 'Kingston', country: 'Jamaica' },
];

function roundToBucket(value: number, bucketDeg: number): number {
  return Math.round(value / bucketDeg) * bucketDeg;
}

function coordKey(lat: number, lng: number, bucketDeg: number): string {
  return `${roundToBucket(lat, bucketDeg).toFixed(3)},${roundToBucket(lng, bucketDeg).toFixed(3)}`;
}

function findNearestCityFromList(lat: number, lng: number, cities: CityEntry[]): CityEntry | null {
  let best: CityEntry | null = null;
  let bestDist = Infinity;
  for (const c of cities) {
    const d = haversineDist(lat, lng, c.lat, c.lng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** The offline city DB in memory: entries by coordinate-bucket key. */
export interface CityDb {
  bucketDeg: number;
  entries: Map<string, ResolvedCity>;
}

/**
 * The seed cities merged with a parsed offline-city-db.json (null when there
 * is none): file entries override seeds in the same bucket, and malformed
 * entries are skipped.
 */
export function buildCityDb(
  file: OfflineCityDbFile | null,
  bucketDeg: number = DEFAULT_CITY_BUCKET_DEG,
): CityDb {
  const map = new Map<string, ResolvedCity>();
  for (const seed of CITIES) {
    const key = coordKey(seed.lat, seed.lng, bucketDeg);
    map.set(key, {
      ...seed,
      key,
      source: 'seed',
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  }

  const entries = file && Array.isArray(file.entries) ? file.entries : [];
  for (const e of entries) {
    if (
      typeof e?.lat === 'number' &&
      typeof e?.lng === 'number' &&
      typeof e?.name === 'string' &&
      typeof e?.country === 'string'
    ) {
      const key = e.key || coordKey(e.lat, e.lng, bucketDeg);
      map.set(key, {
        key,
        lat: e.lat,
        lng: e.lng,
        name: e.name,
        country: e.country,
        source:
          e.source === 'online' || e.source === 'fallback' || e.source === 'seed'
            ? e.source
            : 'fallback',
        updatedAt:
          typeof e.updatedAt === 'string'
            ? e.updatedAt
            : new Date().toISOString(),
      });
    }
  }

  return { bucketDeg, entries: map };
}

/** The offline-city-db.json text for a DB, entries sorted by country, name, key. */
export function serializeCityDb(db: CityDb, updatedAt: string): string {
  const entries = [...db.entries.values()].sort(
    (a, b) =>
      a.country.localeCompare(b.country) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
  const payload: OfflineCityDbFile = {
    version: 1,
    updatedAt,
    entries,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * An online reverse geocoder the caller may plug into the CityResolver (the
 * CLI's rate-limited Nominatim client). Budget and throttling are its job.
 */
export interface OnlineGeocoder {
  /** Whether another lookup is allowed (e.g. lookup budget left) */
  canLookup(): boolean;
  /** Reverse-geocodes a coordinate, using up one lookup; null when nothing was found or the request failed */
  lookup(lat: number, lng: number): Promise<{ name: string; country: string } | null>;
}

export interface CityResolverOptions {
  /** Online lookups for bucket misses; offline-only without one */
  geocoder?: OnlineGeocoder;
  /** Retry existing 'fallback' entries through the geocoder (while it allows lookups) */
  refreshFallbackEntries?: boolean;
}

export interface CityResolverStats {
  totalEntries: number;
  cacheHits: number;
  onlineHits: number;
  fallbackHits: number;
}

export class CityResolver {
  private readonly cityDb: Map<string, ResolvedCity>;
  private readonly bucketDeg: number;
  private readonly geocoder: OnlineGeocoder | undefined;
  private readonly refreshFallbackEntries: boolean;

  public cacheHits = 0;
  public onlineHits = 0;
  public fallbackHits = 0;

  constructor(db: CityDb, options: CityResolverOptions = {}) {
    this.cityDb = db.entries;
    this.bucketDeg = db.bucketDeg;
    this.geocoder = options.geocoder;
    this.refreshFallbackEntries = options.refreshFallbackEntries ?? false;
  }

  private getNearestFallback(lat: number, lng: number): CityEntry | null {
    return findNearestCityFromList(lat, lng, [...this.cityDb.values()]);
  }

  async resolve(lat: number, lng: number): Promise<ResolvedCity | null> {
    const key = coordKey(lat, lng, this.bucketDeg);
    const existing = this.cityDb.get(key);
    const shouldRefreshFallback =
      existing?.source === 'fallback' &&
      this.refreshFallbackEntries &&
      this.geocoder !== undefined &&
      this.geocoder.canLookup();

    if (existing && !shouldRefreshFallback) {
      this.cacheHits++;
      return existing;
    }

    if (this.geocoder?.canLookup()) {
      const online = await this.geocoder.lookup(lat, lng);
      if (online) {
        const entry: ResolvedCity = {
          key,
          lat: roundToBucket(lat, this.bucketDeg),
          lng: roundToBucket(lng, this.bucketDeg),
          name: online.name,
          country: online.country,
          source: 'online',
          updatedAt: new Date().toISOString(),
        };
        this.cityDb.set(key, entry);
        this.onlineHits++;
        return entry;
      }
    }

    const nearest = this.getNearestFallback(lat, lng);
    if (!nearest) return null;
    const fallback: ResolvedCity = {
      key,
      lat: roundToBucket(lat, this.bucketDeg),
      lng: roundToBucket(lng, this.bucketDeg),
      name: nearest.name,
      country: nearest.country,
      source: 'fallback',
      updatedAt: new Date().toISOString(),
    };
    this.cityDb.set(key, fallback);
    this.fallbackHits++;
    return fallback;
  }

  /** Resolves every distinct bucket among `coords`, in order; `onProgress` fires every 200 and at the end. */
  async prefill(
    coords: { lat: number; lng: number }[],
    onProgress?: (done: number, total: number) => void,
  ) {
    const uniqueByKey = new Map<string, { lat: number; lng: number }>();
    for (const c of coords) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      const key = coordKey(c.lat, c.lng, this.bucketDeg);
      if (!uniqueByKey.has(key)) uniqueByKey.set(key, c);
    }

    const unique = [...uniqueByKey.values()];
    for (let i = 0; i < unique.length; i++) {
      const c = unique[i];
      await this.resolve(c.lat, c.lng);
      if ((i + 1) % 200 === 0 || i + 1 === unique.length) {
        onProgress?.(i + 1, unique.length);
      }
    }
  }

  /** Cached entry for a coordinate's bucket, without any lookup or refresh. */
  peek(lat: number, lng: number): ResolvedCity | undefined {
    return this.cityDb.get(coordKey(lat, lng, this.bucketDeg));
  }

  getStats(): CityResolverStats {
    return {
      totalEntries: this.cityDb.size,
      cacheHits: this.cacheHits,
      onlineHits: this.onlineHits,
      fallbackHits: this.fallbackHits,
    };
  }
}
