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
  → pages
```

**The interfaces in `src/types.ts` must mirror the JSON shapes written by `scripts/preprocess.ts`.** There is no shared code between the two (the script defines its own local interfaces), so any change to a generated file's shape must be made in both places, and `npm run preprocess` must be re-run for the frontend to see it.

Raw input format: on-device Timeline export with a top-level `semanticSegments` array; each segment has either a `visit` (place, with `topCandidate.semanticType` like `HOME`/`INFERRED_HOME`/`WORK`) or an `activity` (movement, with `topCandidate.type` like `FLYING`/`WALKING`), plus optional `timelinePath` point lists. Coordinates are strings like `"40.60°, -3.70°"` parsed by `parseLatLng`. Extra top-level keys (`rawSignals`, `userLocationProfile`) are ignored.

## Gotchas

- `scripts/data/offline-city-db.json` is **committed and self-updating**: each preprocess run merges seed cities + existing entries + new Nominatim lookups and rewrites the file. Don't hand-edit it; don't gitignore it.
- Nominatim rate limit: default 1 req/s, max 80 lookups per run (env-tunable, see README). Keep the User-Agent header.
- Nights/dates are bucketed at **UTC midnight**, not local time — a known approximation (roadmap item). The calendar heatmap also uses `toISOString()` date keys.
- `useData.ts` caches fetch promises at module level because pages unmount on nav (App.tsx conditionally renders pages; there is no router). Failed fetches are evicted so reloads retry.
- Shared UI constants (transport-mode colors/labels, chart tooltip style) live in `src/constants.ts` — don't re-declare them in pages.
- Preprocessing loads the entire Timeline.json into memory with `JSON.parse`; fine on a dev machine, just slow — don't add per-segment async work outside the existing CityResolver batching.
- Flight/route paths come from the *preceding* segment's `timelinePath` (index `i - 1`), a quirk of the export format.

## Style

- Tailwind utility classes, dark theme only (gray-950 background, gray-900 cards, orange accent).
- Recharts for charts, react-leaflet for maps; chart tooltips use `CHART_TOOLTIP_STYLE`.
- ESLint flat config (`eslint.config.js`) with typescript-eslint + react-hooks rules; keep `lint` clean — the react-hooks rules exist because state-in-effect bugs have occurred here before.
