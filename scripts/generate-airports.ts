/**
 * One-off generator for scripts/data/airports.json — NOT run by `npm run
 * preprocess` and not part of the regular build. Run manually, on demand,
 * whenever the vendored airport list needs refreshing:
 *
 *   npx tsx scripts/generate-airports.ts
 *
 * Source: OurAirports' public-domain airports.csv export
 * (https://ourairports.com/data/, mirrored at
 * https://davidmegginson.github.io/ourairports-data/airports.csv). OurAirports
 * data is public domain (Unlicense) — see https://ourairports.com/data/ for
 * the source's own terms.
 *
 * This script downloads that CSV (a one-off network use; neither
 * `npm run preprocess` nor the in-browser import fetches it — see CLAUDE.md)
 * and trims it down to what the flights feature needs: `large_airport` and
 * `medium_airport` rows that have an IATA code, keeping only iata, name, lat/lng,
 * municipality, and size (large/medium, used to break near-ties when
 * matching a flight's endpoint to the nearest airport — see
 * `findNearestAirport` in src/pipeline/airports.ts). The result is committed
 * at scripts/data/airports.json so the app never fetches it at runtime.
 */
import * as fs from 'fs';
import * as path from 'path';

const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OUT_PATH = path.join(path.resolve('.'), 'scripts', 'data', 'airports.json');

interface AirportEntry {
  iata: string;
  name: string;
  lat: number;
  lng: number;
  municipality: string;
  /** OurAirports `type`, trimmed to the two kinds this file keeps */
  size: 'large' | 'medium';
}

/** Minimal RFC 4180 CSV row splitter: handles quoted fields, embedded commas, and "" escapes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

/** Splits full CSV text into rows, respecting newlines embedded inside quoted fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === '\n' && !inQuotes) {
      if (row.length > 0) rows.push(parseCsvLine(row));
      row = '';
    } else if (c !== '\r') {
      row += c;
    }
  }
  if (row.trim().length > 0) rows.push(parseCsvLine(row));
  return rows;
}

async function main() {
  console.log(`Downloading ${CSV_URL} …`);
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  console.log(`  ${(text.length / 1_000_000).toFixed(1)} MB downloaded`);

  const rows = parseCsv(text);
  const header = rows[0];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column not found: ${name}`);
    return i;
  };
  const idx = {
    type: col('type'),
    name: col('name'),
    lat: col('latitude_deg'),
    lng: col('longitude_deg'),
    municipality: col('municipality'),
    iata: col('iata_code'),
  };

  const airports: AirportEntry[] = [];
  for (const r of rows.slice(1)) {
    const type = r[idx.type];
    if (type !== 'large_airport' && type !== 'medium_airport') continue;
    const iata = r[idx.iata]?.trim().toUpperCase();
    if (!iata) continue;
    const lat = Number(r[idx.lat]);
    const lng = Number(r[idx.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    airports.push({
      iata,
      name: r[idx.name],
      lat,
      lng,
      municipality: r[idx.municipality] ?? '',
      size: type === 'large_airport' ? 'large' : 'medium',
    });
  }

  // Stable order for clean diffs on regeneration
  airports.sort((a, b) => a.iata.localeCompare(b.iata));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(airports));
  const sizeKb = fs.statSync(OUT_PATH).size / 1024;
  console.log(`  ${airports.length} airports written to ${path.relative('.', OUT_PATH)} (${sizeKb.toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
