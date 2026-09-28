/**
 * Online reverse geocoding through OpenStreetMap's Nominatim, for the CLI's
 * city resolution (the one network access of `npm run preprocess`; the
 * in-browser import never geocodes online).
 *
 * Plugged into the pipeline's CityResolver as its OnlineGeocoder: it owns the
 * lookup budget (CITY_DB_MAX_ONLINE_LOOKUPS) and the throttle
 * (CITY_DB_ONLINE_RPS; Nominatim's usage policy allows at most 1 request per
 * second and requires an identifying User-Agent — keep both).
 */
import type { OnlineGeocoder } from '../src/pipeline/index.ts';

async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
  timeoutMs: number,
  userAgent: string,
): Promise<{ name: string; country: string } | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lng)}&zoom=10&addressdetails=1&accept-language=en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      address?: Record<string, string>;
    };
    const address = payload.address ?? {};
    const name =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      address.county ||
      address.state_district ||
      address.state;
    const country = address.country;
    if (!name || !country) return null;
    return { name, country };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export class NominatimGeocoder implements OnlineGeocoder {
  private readonly maxLookups: number;
  private readonly timeoutMs: number;
  private readonly minRequestGapMs: number;
  private readonly userAgent: string;
  private lastRequestMs = 0;

  /** Lookups made so far (each one counts, found or not) */
  public lookupsUsed = 0;

  constructor(options: {
    maxLookups: number;
    timeoutMs: number;
    requestsPerSecond: number;
    userAgent: string;
  }) {
    this.maxLookups = options.maxLookups;
    this.timeoutMs = options.timeoutMs;
    this.minRequestGapMs = Math.max(0, Math.floor(1000 / options.requestsPerSecond));
    this.userAgent = options.userAgent;
  }

  canLookup(): boolean {
    return this.lookupsUsed < this.maxLookups;
  }

  private async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestMs;
    if (elapsed < this.minRequestGapMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minRequestGapMs - elapsed));
    }
    this.lastRequestMs = Date.now();
  }

  async lookup(lat: number, lng: number): Promise<{ name: string; country: string } | null> {
    await this.throttle();
    this.lookupsUsed++;
    return reverseGeocodeNominatim(lat, lng, this.timeoutMs, this.userAgent);
  }
}
