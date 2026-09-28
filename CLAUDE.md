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

**Every displayed number respects the global time range** (`src/timeRange.ts`; `TimeRangeProvider` wraps the page switch in App.tsx and derives the selection from the URL hash). So preprocess emits dated per-record data (activity columns in `stats.json`, `stays` on visits, per-night cities and per-date country `presence` in `geography.json`), never all-time totals, and pages aggregate via `src/aggregate.ts` with `useMemo` over data + range. Records are keyed by the event-local date (`startTime.slice(0, 10)`), except nights (the `nights-away.json` key) and days present (UTC dates, to match the choropleth's all-time totals); "All time" is an open range (`null` bounds) and must never exclude anything. The one exception is the trip detail page (`src/pages/TripDetail.tsx`), which always shows the whole trip: `src/trip.ts` filters the same per-record datasets to the trip's own date windows instead of the global range, and uses `trips.json` only to find the trip's dates, so it stays right however preprocess groups nights into trips.

**The URL hash is the source of truth for view state** (`src/route.ts`, a small `useSyncExternalStore` store over `location.hash`; no router library): the page (`#/flights`), the global range (`range`/`from`/`to` params, encoded in `timeRange.ts`), and per-page state (Flights sort, NightsAway year, TravelMap layers). Read it with `useRoute()` and derive; write with `setParams` — never mirror it into `useState`. Only non-default values are written. Range params are global (the nav links carry them, listed first); every other param is page-local and dropped on page change, so pages must not reuse the range keys. Range changes push history entries, per-page state replaces the current one. New per-page state worth sharing follows the same pattern. Trip pages are `#/trip?start=<first night>` (build links with `tripHref`, passing the current range params); `trip` has no nav tab (App's `PARENT_PAGE` highlights Nights Away instead) and names the browser tab itself. Redirects from code use `navigate(route, { replace: true })`; a page effect that navigates must first check `useRoute().page` is still its own, since a browser-initiated hash change (address bar) can re-render the page once with the next page's route before App unmounts it.

Raw input format: on-device Timeline export with a top-level `semanticSegments` array; each segment has either a `visit` (place, with `topCandidate.semanticType` like `HOME`/`INFERRED_HOME`/`WORK`) or an `activity` (movement, with `topCandidate.type` like `FLYING`/`WALKING`), plus optional `timelinePath` point lists. Coordinates are strings like `"40.60°, -3.70°"` parsed by `parseLatLng`. Extra top-level keys (`rawSignals`, `userLocationProfile`) are ignored.

## Gotchas

- `scripts/data/offline-city-db.json` is **committed and self-updating**: each preprocess run merges seed cities + existing entries + new Nominatim lookups and rewrites the file. Don't hand-edit it; don't gitignore it.
- Nominatim rate limit: default 1 req/s, max 80 lookups per run (env-tunable, see README). Keep the User-Agent header.
- Nights/dates are bucketed at **UTC midnight**, not local time — a known approximation (roadmap item); `nights-away.json` starts a day before the first segment for that reason. The calendar heatmap keys each cell by its own calendar date string and shows the night with that key.
- East of UTC a night's key is the date of the **evening it begins**, so a trip's travel days run from its first night's date to the day after its last night (`tripWindows` in `src/trip.ts`; outbound flights fall on the first night's date, return flights the day after the last). Revisit that function if night bucketing changes.
- `useData.ts` caches fetch promises at module level because pages unmount on nav (App.tsx conditionally renders the page named by the URL hash). Failed fetches are evicted so reloads retry.
- Shared UI constants (transport-mode colors/labels, the home/away night palette, chart tooltip style, app title) live in `src/constants.ts` — don't re-declare them in pages. Flight arcs come from `greatCircleArc` in `src/flight.ts`.
- Preprocessing loads the entire Timeline.json into memory with `JSON.parse`; fine on a dev machine, just slow — don't add per-segment async work outside the existing CityResolver batching.
- Flight/route paths come from the *preceding* segment's `timelinePath` (index `i - 1`), a quirk of the export format.
- `public/world-countries.geo.json` is vendored (simplified Natural Earth, see README) and read by **both** preprocess (names → ISO codes for `geography.json`, whose `countries` are merged by ISO code and referenced by index from `cities` and `presence`) and the Overview map (shapes). If preprocess warns "No map geometry for: X", add X to `COUNTRY_ALIASES` rather than editing the GeoJSON.
- README's **Features** section is the canonical user-facing list of what the app can do. Whenever a Roadmap item is implemented, move it out of Roadmap and describe it under Features in the same change — keep the two sections in sync.

## Style

- Tailwind utility classes, dark theme only (gray-950 background, gray-900 cards, orange accent).
- Recharts for charts, react-leaflet for maps; chart tooltips use `CHART_TOOLTIP_STYLE`.
- ESLint flat config (`eslint.config.js`) with typescript-eslint + react-hooks rules; keep `lint` clean — the react-hooks rules exist because state-in-effect bugs have occurred here before.
