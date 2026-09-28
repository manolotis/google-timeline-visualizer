# CLAUDE.md

Personal travel dashboard that visualizes a Google Maps Timeline export. Two-stage architecture: a Node preprocessing script reduces the ~100MB raw export to small derived JSON files, which a static React SPA fetches at runtime. See README.md for features and user-facing docs.

## Commands

```bash
npm run dev         # Vite dev server at localhost:5173
npm run build       # tsc -b && vite build → dist/
npm run preprocess  # Timeline.json → public/data/*.json (needs Timeline.json in root)
npm run typecheck   # tsc --noEmit over src/ and scripts/
npm run lint        # ESLint over src/ and scripts/
```

There are no tests. Verification = `typecheck` + `lint` + `build`, plus a manual check in the dev server. The app renders a guidance screen (EmptyState) when `public/data/` is missing, so the frontend can be exercised without real data.

## Data flow & key invariant

```
Timeline.json (gitignored, personal data, ~100MB, on-device export format)
  → scripts/preprocess.ts        (run via tsx)
  → public/data/*.json           (gitignored)
  → src/hooks/useData.ts         (fetch hooks with module-level cache)
  → src/aggregate.ts             (sums records inside the global time range)
  → pages
```

**The interfaces in `src/types.ts` must mirror the JSON shapes written by `scripts/preprocess.ts`.** There is no shared code between the two (the script defines its own local interfaces), so any change to a generated file's shape must be made in both places, and `npm run preprocess` must be re-run for the frontend to see it.

**Every displayed number respects the global time range** (`src/timeRange.ts`; `TimeRangeProvider` wraps the page switch in App.tsx and derives the selection from the URL hash). So preprocess emits dated per-record data (activity columns in `stats.json`, `stays` on visits, per-night cities and per-date country `presence` in `geography.json`), never all-time totals, and pages aggregate via `src/aggregate.ts` with `useMemo` over data + range. Every record is keyed by a **local date** (where the user was at the time; see the local-time gotcha below); "All time" is an open range (`null` bounds) and must never exclude anything. The one exception is the trip detail page (`src/pages/TripDetail.tsx`), which always shows the whole trip: `src/trip.ts` filters the same per-record datasets to the trip's own date windows instead of the global range, and uses `trips.json` only to find the trip's dates, so it stays right however preprocess groups nights into trips.

**The URL hash is the source of truth for view state** (`src/route.ts`, a small `useSyncExternalStore` store over `location.hash`; no router library): the page (`#/flights`), the global range (`range`/`from`/`to` params, encoded in `timeRange.ts`), and per-page state (Flights sort, NightsAway year, TravelMap layers). Read it with `useRoute()` and derive; write with `setParams` — never mirror it into `useState`. Only non-default values are written. Range params are global (the nav links carry them, listed first); every other param is page-local and dropped on page change, so pages must not reuse the range keys. Range changes push history entries, per-page state replaces the current one. New per-page state worth sharing follows the same pattern. Trip pages are `#/trip?start=<first night>` (build links with `tripHref`, passing the current range params); `trip` has no nav tab (App's `PARENT_PAGE` highlights Nights Away instead) and names the browser tab itself. Redirects from code use `navigate(route, { replace: true })`; a page effect that navigates must first check `useRoute().page` is still its own, since a browser-initiated hash change (address bar) can re-render the page once with the next page's route before App unmounts it.

Raw input format: on-device Timeline export with a top-level `semanticSegments` array; each segment has either a `visit` (place, with `topCandidate.semanticType` like `HOME`/`INFERRED_HOME`/`WORK`) or an `activity` (movement, with `topCandidate.type` like `FLYING`/`WALKING`), plus optional `timelinePath` point lists. Coordinates are strings like `"40.60°, -3.70°"` parsed by `parseLatLng`. Extra top-level keys (`rawSignals`, `userLocationProfile`) are ignored.

## Gotchas

- `scripts/data/offline-city-db.json` is **committed and self-updating**: each preprocess run merges seed cities + existing entries + new Nominatim lookups and rewrites the file. Don't hand-edit it; don't gitignore it.
- Nominatim rate limit: default 1 req/s, max 80 lookups per run (env-tunable, see README). Keep the User-Agent header.
- **Local time comes from the per-segment offset fields, not the timestamps.** The export writes every ISO timestamp in the *phone's* time zone (on a phone set to CET, a flight leaving San Francisco at 13:35 reads `…T22:35…+01:00`); each visit/activity's `startTimeTimezoneUtcOffsetMinutes`/`endTime…` holds the real local offset. Preprocess re-expresses every timestamp it emits in that offset (`localStart`/`localEnd`; timelinePath-only segments lack the fields and fall back to the string's own offset), so a timestamp's `slice(0, 10)` *is* the local date and `slice(11, 13)` the local hour: stays, activities, flights (departure date), routes, home samples and days present (each local date a visit spans) all use that. Emitted timestamps therefore carry mixed offsets: order them with `Date.parse`, never string comparison. Frontend date logic is pure calendar arithmetic on `YYYY-MM-DD` strings (`dayNumber`/`addDays` in `timeRange.ts`) and must not depend on the browser's time zone.
- A **night is keyed by the local date of the evening it begins**: night D is 20:00 on D → 08:00 on D+1, each candidate visit judged in its own local time (its start offset), and the visit overlapping that window most is where it was spent. If no visit overlaps but a flight (≤ 20 h; longer "flights" are gap-filler artifacts) is in the air at local midnight, the night counts at the flight's departure point, so an overnight flight home stays a night away. `nights-away.json` has one night per local date from the first segment's start to the last one's end. So a trip's travel days run from its first night's date to the day after its last night (`tripWindows` in `src/trip.ts`): outbound flights fall on the first night's date, return flights on the day after the last night or, for evening departures, on the last night itself. The calendar heatmap keys each cell by its calendar date string and shows the night with that key.
- `useData.ts` caches fetch promises at module level because pages unmount on nav (App.tsx conditionally renders the page named by the URL hash). Failed fetches are evicted so reloads retry.
- Shared UI constants (transport-mode colors/labels, the home/away night palette, chart tooltip style, app title) live in `src/constants.ts` — don't re-declare them in pages. Flight arcs come from `greatCircleArc` in `src/flight.ts`.
- Preprocessing loads the entire Timeline.json into memory with `JSON.parse`; fine on a dev machine, just slow — don't add per-segment async work outside the existing CityResolver batching.
- Flight/route paths come from the *preceding* segment's `timelinePath` (index `i - 1`), a quirk of the export format.
- `scripts/data/airports.json` is **vendored, committed, and never fetched at preprocess or app runtime** — a trimmed copy of OurAirports' `airports.csv` (public domain), `large_airport`/`medium_airport` rows with an IATA code only, `{iata, name, lat, lng, municipality, size}`. Regenerate it with `npx tsx scripts/generate-airports.ts` (the one place in this repo that makes a network request — a one-off manual step, not part of `npm run preprocess`). Preprocess matches each flight endpoint to the nearest airport within 40 km (`findNearestAirport`; a `large` airport gets a 5 km scoring discount over `medium` on near-ties) and estimates `co2Kg` per flight (`estimateFlightCo2Kg`: great-circle distance + 95 km detour, a DEFRA-style per-km factor by haul, × 1.9 RF multiplier — see the comment above that function, and README's [CO2 Estimate](README.md#co2-estimate), for the exact factors and source).
- **Home is a list of periods**: `home.json` is `HomePeriod[]` (`{start, end | null, lat, lng, city, country}`, oldest first, `end: null` = current home; see README "Home Periods"). Every night's `isHome`/`distKm`, and therefore trips and `geography.json` away nights, is measured against the home of that night's period. A night outside every period belongs to the nearest period in time, ties to the earlier one. That rule lives in **two places** that must agree: `periodIndexForDate` (preprocess) and `homePeriodsInRange` (`src/aggregate.ts`, which picks the Travel Map markers and the NightsAway header). `isStaleHome` catches the old single `{lat, lng}` file and the pages show a re-run hint.
- Home detection (`detectHomePeriods`) uses HOME/INFERRED_HOME visits only to nominate candidate places. The monthly evidence is **nights slept** within `HOME_RADIUS_KM` (1 km), because the labels are sparse (whole months unlabelled) and also get put on a family home during holiday stays. Don't switch it to counting labels. Candidates are clustered by distance, not the 0.1° city-DB grid: this user's Eindhoven home sits on the 51.45° bucket edge and a grid splits it in two. `HOME_MIN_PERIOD_MONTHS` (default 5) is the one tuning knob; merged segments count support *net* of the months that interrupted them, which keeps sparse 2013–14 data from forming a fake home. Home `city`/`country` come from `CityResolver.peek` (cache only, no lookups).
- `public/world-countries.geo.json` is vendored (simplified Natural Earth, see README) and read by **both** preprocess (names → ISO codes for `geography.json`, whose `countries` are merged by ISO code and referenced by index from `cities` and `presence`) and the Overview map (shapes). If preprocess warns "No map geometry for: X", add X to `COUNTRY_ALIASES` rather than editing the GeoJSON.
- README's **Features** section is the canonical user-facing list of what the app can do. Whenever a Roadmap item is implemented, move it out of Roadmap and describe it under Features in the same change — keep the two sections in sync.

## Style

- Tailwind utility classes, dark theme only (gray-950 background, gray-900 cards, orange accent).
- Recharts for charts, react-leaflet for maps; chart tooltips use `CHART_TOOLTIP_STYLE`.
- ESLint flat config (`eslint.config.js`) with typescript-eslint + react-hooks rules; keep `lint` clean — the react-hooks rules exist because state-in-effect bugs have occurred here before.
