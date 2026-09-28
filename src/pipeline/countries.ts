/**
 * Country matching: geocoder country names → ISO 3166-1 alpha-3 codes, via
 * the name fields of the vendored world geometry the frontend map draws
 * (public/world-countries.geo.json), so every emitted code has a shape.
 */
import type { WorldCountryNames } from './types';

export interface CountryMatch {
  iso3: string;
  name: string;
}

/**
 * Country names used by the seed city list or returned by Nominatim that
 * don't appear in Natural Earth's name fields, mapped to a name that does.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  USA: 'United States',
  US: 'United States',
  UK: 'United Kingdom',
  'Great Britain': 'United Kingdom',
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
  UAE: 'United Arab Emirates',
  Bosnia: 'Bosnia and Herzegovina',
  Türkiye: 'Turkey',
  'Palestinian Territories': 'Palestine',
  'Palestinian Territory': 'Palestine',
  'State of Palestine': 'Palestine',
  'Congo-Kinshasa': 'Democratic Republic of the Congo',
  'Congo-Brazzaville': 'Republic of the Congo',
  Swaziland: 'Eswatini',
  Burma: 'Myanmar',
  Macedonia: 'North Macedonia',
  'Holy See': 'Vatican City',
};

/** "Côte d'Ivoire" → "cote d ivoire", "The Bahamas" → "bahamas" */
export function normalizeCountryName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/**
 * Normalized country name → ISO code + display name, from the world
 * geometry's feature properties (empty without them: no ISO codes).
 */
export function buildCountryIndex(countries: WorldCountryNames[]): Map<string, CountryMatch> {
  const index = new Map<string, CountryMatch>();
  const nameLists = countries.map((c) => [c.name, ...(c.names ?? [])]);
  // Register rank by rank so a country's primary name always wins over
  // another country's alternate name.
  const maxRank = Math.max(0, ...nameLists.map((l) => l.length));
  for (let rank = 0; rank < maxRank; rank++) {
    countries.forEach((c, i) => {
      const name = nameLists[i][rank];
      const key = name ? normalizeCountryName(name) : '';
      if (key && !index.has(key)) {
        index.set(key, { iso3: c.iso3, name: c.name });
      }
    });
  }
  for (const [alias, target] of Object.entries(COUNTRY_ALIASES)) {
    const match = index.get(normalizeCountryName(target));
    const key = normalizeCountryName(alias);
    if (match && !index.has(key)) index.set(key, match);
  }
  return index;
}
