# CLAUDE.md

Personal travel dashboard that visualizes a Google Maps Timeline export. Two-stage architecture: a shared, environment-agnostic pipeline (`src/pipeline/`) reduces the ~100MB raw export to small derived datasets, and a static React SPA reads them. The pipeline runs either in the browser (drag-and-drop import in a Web Worker, result kept in IndexedDB — the default path) or from the Node CLI (`npm run preprocess` → `public/data/*.json`). See README.md for features and user-facing docs.

## Commands

```bash
npm run dev         # Vite dev server at localhost:5173
npm run build       # tsc -b + pipeline typecheck && vite build → dist/
npm run preprocess  # CLI: Timeline.json → public/data/*.json (needs Timeline.json in root)
npm run typecheck   # tsc --noEmit over src/ and scripts/, then src/pipeline/ alone via tsconfig.pipeline.json (no DOM/Node types)
npm run lint        # ESLint over src/ and scripts/
npm run test        # Vitest, once (src/**/*.test.ts): pure pipeline helpers + src/timeRange.ts, synthetic fixtures only
```

Verification = `typecheck` + `lint` + `test` + `build`, plus a manual check in the dev server (also run in CI, `.github/workflows/ci.yml`, on push/PR to `main`). The app renders the import drop zone (EmptyState) when there's no data (no IndexedDB import, no `public/data/`), so the frontend can be exercised without preprocessing. For any change under `src/pipeline/`, also diff the CLI output before/after (`CITY_DB_ENABLE_ONLINE=0 npm run preprocess`, `cmp` every `public/data/*.json`; revert `scripts/data/offline-city-db.json` afterwards) — the browser import runs the same code, so byte-identical CLI output covers both paths. Tests never touch `Timeline.json` or `public/data/`: they build tiny synthetic timelines by hand (obviously fake coordinates/dates), colocated as `src/**/*.test.ts` (kept out of `tsconfig.pipeline.json`'s strict no-DOM/no-Node check via its `exclude`, since they're checked by the main `tsconfig.json` instead).

## Data flow & key invariant

```
Timeline.json (gitignored, personal data, ~100MB, on-device export format)
  + family-home config (optional: timeline-config.json for the CLI, pasted/loaded at import in the browser)
  → src/pipeline/ runPipeline, run by either
      src/import/worker.ts   (Web Worker, offline-only) → IndexedDB 'timeline-visualizer'
      scripts/preprocess.ts  (Node CLI via tsx)         → public/data/*.json (gitignored)
  → src/hooks/useData.ts     (IndexedDB import if present, else fetch /data/*.json; module-level cache)
  → src/aggregate.ts         (sums records inside the global time range)
  → pages
```

**Dataset types have one source of truth: `src/pipeline/types.ts`.** The pipeline builds the datasets with them (`Datasets`, keyed by `DatasetKey`; file names in `DATASET_FILES`, `src/pipeline/datasets.ts`) and `src/types.ts` re-exports them for the frontend — never re-declare a dataset shape elsewhere. To change a shape: edit the type and the pipeline code, then re-run `npm run preprocess` or re-import for the frontend to see it. If the change would break reading data generated before it, keep the frontend tolerant (fields optional, like `Flight.co2Kg`, or a staleness check like `isStaleHome`) and bump `IMPORT_FORMAT_VERSION` (`src/import/storage.ts`) so older IndexedDB imports are ignored and the footer asks for a re-import.

**The pipeline is environment-agnostic and pure**: no fs/path/process/env, no DOM, no network, no `console` or timers (`tsconfig.pipeline.json` compiles `src/pipeline/` with `lib: ES2022` and no types, so any of these fails typecheck). Inputs come in as parsed JSON (`runPipeline(timeline, { cityDb, countries, airports, familyHomes }, options)`), logging goes through the `log`/`warn` callbacks, and progress through `onProgress(phase)` (`PIPELINE_PHASES`). Environment-specific work stays in the two callers: the CLI reads files and env, plugs in the online geocoder and writes files; the worker reads the dropped `File`, loads reference data and posts JSON back. The CLI's output and console log must stay byte-identical across pipeline refactors.

**Every displayed number respects the global time range** (`src/timeRange.ts`; `TimeRangeProvider` wraps the page switch in App.tsx and derives the selection from the URL hash). So the pipeline emits dated per-record data (activity columns in `stats.json`, `stays` on visits, per-night cities and per-date country `presence` in `geography.json`), never all-time totals, and pages aggregate via `src/aggregate.ts` with `useMemo` over data + range. Every record is keyed by a **local date** (where the user was at the time; see the local-time gotcha below); "All time" is an open range (`null` bounds) and must never exclude anything. Two pages are the exception, and both say so with a small note when the global range isn't All time: the trip detail page (`src/pages/TripDetail.tsx`), which always shows the whole trip (`src/trip.ts` filters the same per-record datasets to the trip's own date windows instead of the global range, and uses `trips.json` only to find the trip's dates, so it stays right however the pipeline groups nights into trips); and the Compare page (`src/pages/Compare.tsx`, `#/compare?a=2024&b=2025`), which always compares two whole calendar years chosen by its own `a`/`b` URL params (page-local state, like Flights' sort order) via `yearRange(year)` from `timeRange.ts`, independent of whatever range is active elsewhere.

**The URL hash is the source of truth for view state** (`src/route.ts`, a small `useSyncExternalStore` store over `location.hash`; no router library): the page (`#/flights`), the global range (`range`/`from`/`to` params, encoded in `timeRange.ts`), and per-page state (Flights sort, NightsAway year, TravelMap layers and open player). Read it with `useRoute()` and derive; write with `setParams` — never mirror it into `useState`. Only non-default values are written. Range params are global (the nav links carry them, listed first); every other param is page-local and dropped on page change, so pages must not reuse the range keys. Range changes push history entries, per-page state replaces the current one. New per-page state worth sharing follows the same pattern. Trip pages are `#/trip?start=<first night>` (build links with `tripHref`, passing the current range params); `trip` has no nav tab (App's `PARENT_PAGE` highlights Nights Away instead) and names the browser tab itself. Redirects from code use `navigate(route, { replace: true })`; a page effect that navigates must first check `useRoute().page` is still its own, since a browser-initiated hash change (address bar) can re-render the page once with the next page's route before App unmounts it.

Raw input format: on-device Timeline export with a top-level `semanticSegments` array; each segment has either a `visit` (place, with `topCandidate.semanticType` like `HOME`/`INFERRED_HOME`/`WORK`) or an `activity` (movement, with `topCandidate.type` like `FLYING`/`WALKING`), plus optional `timelinePath` point lists. Coordinates are strings like `"48.86°, 2.29°"` parsed by `parseLatLng`. Extra top-level keys (`rawSignals`, `userLocationProfile`) are ignored.

## Pipeline layout (`src/pipeline/`)

- `run.ts` — `runPipeline` (the §1–§8 stages: visits, cities, flights, nights, home periods, family homes, geography, trips, activity log, routes) plus `validateTimeline`/`TimelineFormatError`.
- `types.ts` — raw export, reference inputs and dataset types (see the invariant above). `datasets.ts` — `DATASET_FILES`/`DATASET_KEYS` and `PIPELINE_PHASES`.
- `cities.ts` (seed cities, `buildCityDb`, `serializeCityDb`, `CityResolver` with the optional `OnlineGeocoder` hook), `countries.ts` (`COUNTRY_ALIASES`, `buildCountryIndex`), `homes.ts` (home periods, `periodIndexForDate`), `familyHomes.ts` (`parseTimelineConfig`, `familyHomeAt`), `airports.ts` (`findNearestAirport`, `estimateFlightCo2Kg`), `util.ts` (coordinates, distances, day numbers, local time).
- `index.ts` is the barrel the CLI and the worker import. The main thread imports only `datasets.ts`, `familyHomes.ts` and types, which keeps the pipeline (and the ~700 KB of reference data) out of the main bundle — check `dist/assets/index-*.js` stays free of pipeline code after changing imports.
- The CLI side: `scripts/preprocess.ts` (thin wrapper: files, env, writes) and `scripts/nominatim.ts` (the Nominatim `OnlineGeocoder`: budget, throttle, User-Agent).

## Gotchas

- `scripts/data/offline-city-db.json` is **committed and self-updating**: each CLI preprocess run merges seed cities + existing entries + new Nominatim lookups (and nearest-city fallbacks) and rewrites the file. Don't hand-edit it; don't gitignore it; revert it after test runs. The in-browser import bundles it (a lazy chunk of the worker) but never writes it back.
- **City resolution order matters**: `CityResolver.resolve` adds every miss (online hit or nearest-city fallback) to the in-memory DB, and later fallbacks can land on those entries. Keep the `resolve`/`prefill` calls in `runPipeline` in their current order, or CLI and import output change.
- **Online lookups are CLI-only.** The pipeline never touches the network; the CLI injects `NominatimGeocoder` as `options.geocoder`. The worker must never get a geocoder (README's privacy promise, Nominatim's usage policy): browser city resolution is offline-only, equal to `CITY_DB_ENABLE_ONLINE=0`. Nominatim rate limit: default 1 req/s, max 80 lookups per run (env-tunable, see README). Keep the User-Agent header.
- **Local time comes from the per-segment offset fields, not the timestamps.** The export writes every ISO timestamp in the *phone's* time zone (on a phone set to CET, a flight leaving San Francisco at 13:35 reads `…T22:35…+01:00`); each visit/activity's `startTimeTimezoneUtcOffsetMinutes`/`endTime…` holds the real local offset. The pipeline re-expresses every timestamp it emits in that offset (`localStart`/`localEnd` in `util.ts`; timelinePath-only segments lack the fields and fall back to the string's own offset), so a timestamp's `slice(0, 10)` *is* the local date and `slice(11, 13)` the local hour: stays, activities, flights (departure date), routes, home samples and days present (each local date a visit spans) all use that. Emitted timestamps therefore carry mixed offsets: order them with `Date.parse`, never string comparison. Frontend date logic is pure calendar arithmetic on `YYYY-MM-DD` strings (`dayNumber`/`addDays` in `timeRange.ts`) and must not depend on the browser's time zone.
- A **night is keyed by the local date of the evening it begins** (20:00 → 08:00 local time), and a trip runs from its first night's date to the day after its last night. Before changing night bucketing, trips, `src/trip.ts` or the calendar heatmap, read [docs/subsystems.md § Nights and trips](docs/subsystems.md#nights-and-trips).
- **Import and data loading** (`src/import/`, `src/hooks/useData.ts`: data-source choice and caches, IndexedDB layout, the import worker): read [docs/subsystems.md § Import and data loading](docs/subsystems.md#import-and-data-loading) before changing them.
- Shared UI constants (transport-mode colors/labels, the home/away/family night palette and family-home marker color, chart tooltip style, app title) live in `src/constants.ts` — don't re-declare them in pages. Flight arcs come from `greatCircleArc` in `src/flight.ts`.
- The pipeline takes the entire parsed Timeline.json in memory (the CLI `JSON.parse`s the file, the worker the dropped `File`'s text); fine on a desktop — don't add per-segment async work outside the existing CityResolver batching.
- Flight/route paths come from the *preceding* segment's `timelinePath` (index `i - 1`), a quirk of the export format.
- `scripts/data/airports.json` is **vendored, committed, and never fetched at preprocess, import or app runtime**. Airport matching and the CO2 estimate: [docs/subsystems.md § Flights and airports](docs/subsystems.md#flights-and-airports).
- **Homes** (home periods, home detection, family homes): read [docs/subsystems.md § Homes](docs/subsystems.md#homes) before changing `src/pipeline/homes.ts`, `src/pipeline/familyHomes.ts` or the home helpers in `src/aggregate.ts`. Two of its rules apply to every task: `timeline-config.json` is **gitignored because it holds personal coordinates — never commit it, and never put real coordinates in `timeline-config.example.json`, README or code comments**; and family-home nights are `isHome: true`, so code that means "at your own home" (the home streak) must use `isOwnHomeNight` (`aggregate.ts`).
- **Travel Map** routes and playback (`src/routeCanvas.ts`, `src/routeIndex.ts`, `src/playback.ts`, `src/pages/TravelMap.tsx`): read [docs/subsystems.md § Travel Map](docs/subsystems.md#travel-map) before changing them.
- `public/world-countries.geo.json` is vendored (simplified Natural Earth, see README) and read by **both** the pipeline (feature names → ISO codes for `geography.json`, whose `countries` are merged by ISO code and referenced by index from `cities` and `presence`; the CLI reads the file, the worker fetches it) and the Overview map (shapes). If preprocess warns "No map geometry for: X", add X to `COUNTRY_ALIASES` (`src/pipeline/countries.ts`) rather than editing the GeoJSON.
- `vite build` copies `public/data/` into `dist/` when it exists: a build made after `npm run preprocess` contains personal data. An import-only build doesn't.
- README's **Features** section is the canonical user-facing list of what the app can do; describe a new capability there in the same change that ships it.

## Style

- Tailwind utility classes, dark theme only (gray-950 background, gray-900 cards, orange accent).
- Recharts for charts, react-leaflet for maps; chart tooltips use `CHART_TOOLTIP_STYLE`.
- ESLint flat config (`eslint.config.js`) with typescript-eslint + react-hooks rules; keep `lint` clean — the react-hooks rules exist because state-in-effect bugs have occurred here before.

## Read on demand

- [docs/subsystems.md](docs/subsystems.md): rules for one subsystem each (import and data loading, nights and trips, homes, flights and airports, Travel Map); the Gotchas above say which section to read before changing which files.
- [README.md](README.md) (≈ 55 KB, user-facing): **Features** is the canonical feature list; **Architecture** explains local time, the generated data files, home periods, family homes, the world geometry, airports, the CO2 estimate, the offline city DB and the preprocess env vars. Read it by slice: `grep -n '^##' README.md`, then read that line range.
- `docs/archive/` holds history moved out of the live docs; read it only to trace why something is the way it is, or when asked.
