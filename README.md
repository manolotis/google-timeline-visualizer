# 🌍 Timeline Visualizer

A personal travel dashboard that transforms your Google Maps Timeline export into rich, interactive visualizations. Explore your flights, trips, nights away from home, movement patterns, and more — all running locally in your browser.

## Features

Everything you can currently see and do with the tool, page by page. Planned additions live in the [Roadmap](#roadmap); when a roadmap item ships, it moves up into this list.

### 📅 Global Time Range
- One **date-range picker in the top bar**, visible on every page: pick a period once and every stat card, chart, table, heatmap, and map shows only that period
- Presets for **All time** (the default), **Last 12 months** (up to your newest data), and **each year** in your data, plus **custom start/end dates** (leave one side empty for an open-ended range)
- The selection persists while you switch pages and is kept in the URL (see [Shareable Links & History](#-shareable-links--history)); the ✕ next to the picker resets to All time
- Trend charts adapt their granularity: per year for long ranges, **per month** for ranges up to three years
- Day-precise: every number is recomputed from dated per-record data, so a custom range is exact rather than rounded to whole months, and All time reproduces the unfiltered totals exactly
- Time-zone aware: every date is the local date wherever you were, not your phone's clock (see [Local Time](#local-time))
- A "no data in this range" hint (with a one-click reset) instead of empty charts when a period has nothing recorded

### 🔗 Shareable Links & History
- Every view has its own URL: the page, the time range, and per-page view settings live in the address bar's `#` hash, so **a reload restores exactly what you were looking at**, and a bookmark or shared link reproduces it (the URL holds view settings only, never your data, so a link opens wherever your copy of the dashboard runs)
- One path per page: `#/overview`, `#/flights`, `#/nights`, `#/map`, `#/statistics`, `#/geography`, plus one per trip, named by its first night: `#/trip?start=2024-03-14`
- Time range as compact parameters: `?range=2024` (a year), `?range=last12m`, or `?from=2024-03-01&to=2024-06-30` (either side may be left out); All time adds nothing
- Per-page settings: Flights sort order (`sort=distance` or `sort=duration`, `dir=asc`), the Nights Away year (`year=2023`), and Travel Map layers (`show=walking`, `hide=flying,in_bus`, `places=off`), e.g. `#/flights?range=2024&sort=distance`
- Only settings that differ from the defaults are written, so an untouched page stays a clean `#/overview`
- Browser **back/forward** step through page and time-range changes (typing a custom date range counts as one step); sorting, year picks, and layer toggles update the current entry instead of piling up history
- The nav tabs are real links: middle-click or Ctrl/⌘-click opens a page in a new tab with the current time range. The browser tab title names the page and range, which also names your bookmarks
- Unknown pages fall back to the Overview for all time, and unreadable parameters are ignored, so a mistyped link never breaks the app. A trip link whose date falls inside a trip opens that trip (so links survive trips being regrouped by a later preprocess run); one that matches no trip opens that year's trip list

### 📊 Overview Dashboard
- At-a-glance stat cards: total flights, nights away, unique places visited, total distance traveled, walking/cycling totals, and trip count
- "Times around the Earth" distance comparison
- **Visited-countries world map** — choropleth with every country visited in the selected range highlighted, colored by days present in that range (home time, day trips and layovers included) on a **quantile scale** recomputed per range, so a weekend trip stays clearly visible next to countries you've lived in for years
  - Hover a country for its name, days present, and nights away from home within the range; countries not visited in the range show as neutral gray
  - Compact legend with the day range of each color class; zoom in to explore dense regions like Europe (scroll-wheel zoom is off so the page still scrolls)
  - Countries too small to see at world zoom (e.g. Andorra) also get a dot
  - Country borders are bundled with the app (no extra network requests)
- Per-year (or per-month) bar charts for flights taken and nights spent away
- Transport mode pie chart and distance breakdown
- Longest and furthest trip highlights, each opening its [trip detail page](#-trip-detail)

### ✈️ Flights
- Full log of every flight detected in the selected range, dated by local departure date
- Sortable table by date, distance, duration, or CO₂
- **Route column** shows the nearest-airport IATA codes, e.g. "AMS → SFO" (full airport name on hover), falling back to resolved city names when a flight endpoint has no nearby airport match (see [Airport Data](#airport-data))
- **Estimated CO₂ per flight and range total**, with a subtitle comparing the range total to the average EU per-capita annual footprint (~7 t/yr) — see [CO2 Estimate](#co2-estimate) for the model and factors
- Interactive world map with **great-circle arcs** for each flight route
- Origin/destination coordinate markers with resolved city names and IATA codes in the tooltip
- Summary stats: total flights, total distance, most repeated route, average duration, estimated CO₂

### 🌙 Nights Away from Home
- **Multi-home support** — "home" is wherever you lived at the time. Home periods are detected automatically (see [Home Periods](#home-periods)), so after a move your new place counts as home and the old one becomes a destination like any other
  - Every night, trip distance and away-night country is measured against the home of that night's period
  - The page header lists the homes that apply to the selected range, e.g. "Eindhoven, Netherlands (2014–2026) → Tres Cantos, Spain (since 2026)"
- **GitHub-style calendar heatmap** — color-coded by distance from home (darker orange = further away); days outside the selected range are shown as outlines
- **Time-zone aware nights** — each night is dated by the local evening it begins and placed where you spent that local night (20:00–08:00), wherever in the world you were, and a night spent on a plane counts as a night away (see [Local Time](#local-time))
- Year-by-year selector (years within the selected range) with per-year count and percentage
- Automatically grouped **trip list** showing dates, number of places, distance from home, and night count (trips that overlap the range, including ones that cross into it); click a trip (or Tab to it and press Enter) to open its [detail page](#-trip-detail)
- Range stats: total nights away, total trips, longest trip, furthest trip

### 🧳 Trip Detail
- One page per trip, opened from the Nights Away trip list or the Overview highlights, with its own shareable URL (`#/trip?start=2024-03-14`); browser back returns to where you came from, and **← Trips in 2024** goes to that year's trip list
- Header with the dates, nights away, return day, farthest distance from home (and where), cities, countries, places visited, total distance traveled, and flights taken
- **Trip map** (dark CARTO basemap, fitted to the trip): ground routes color-coded by transport mode, flights as great-circle arcs, where each night was spent (sized by nights), the other places visited, and home; the legend lists the distance covered per mode
- **Night by night**: a square per night colored by distance from home (hover for the city and distance), then the nights grouped into stops, e.g. "Samokov, Bulgaria · 3 nights"
- **Cities & countries** with nights spent in each and days present, plus the countries passed through without staying the night (layovers, day trips)
- **Flights** taken during the trip, in order, with local departure time, IATA route labels (city as a sub-label), distance, and duration
- Always shows the whole trip, whatever the global time range (the picker stays usable and a small note says so); everything is computed from the trip's dates, from its departure day to the day it got back

### 🗺️ Travel Map
- Full-screen interactive Leaflet map with dark CARTO basemap
- Thousands of route segments rendered as polylines, **color-coded by transport mode** (flying, walking, cycling, driving, train, bus, subway, tram, ferry, motorcycle, sailing, skiing)
- Toggle individual transport modes on/off
- Place markers (top 500 locations visited in the selected range) sized by visit frequency within the range, with tooltips showing the resolved city/country name (via the offline city database) instead of raw place IDs
- A home marker for every home that applies to the selected range, labelled with the years you lived there (e.g. "Home 2014–2026", "Home since 2026")

### 📈 Statistics
- Distance, time spent, and activity count by transport mode (horizontal bar charts, individually colored)
- Distance traveled (line chart) and unique places visited (bar chart) per year, or per month for shorter ranges
- Day-of-week radar chart showing activity distribution
- Hour-of-day bar chart for movement patterns, in local time wherever you were
- Top 20 most visited places in the range, showing resolved city/country name (via the offline city database, with coordinates as a sub-label), semantic type, visit count, and hours spent
- **🏆 Firsts & Streaks**, at the bottom of the page:
  - **New countries/cities per year** — each country/city's *lifetime* first-visit year (from all-time data, not the selected range), listed as chip rows per year with an expandable list for long years; the selected range only limits which years are shown, it never changes which year counts as "new"
  - **Longest travel streak** and **longest home streak** — the longest run of consecutive nights away from / at home, computed for the selected range and clipped at its edges like every other range-aware number in the app; a night with no tracked location data ends a streak, and the travel streak also lists the distinct cities visited during it
  - **Firsts stat cards** — first flight on record, farthest-ever single night from home, and the year with the most newly visited countries (all all-time, like the per-year lists above)

### 🧭 Geography
- Countries and cities ranked by away-days in the selected range, with summary cards and full share-of-total tables
- Country table also lists **days present** in the range (home time included), the measure behind the Overview world map
- Country name variants from different sources ("USA" / "United States", "Czechia" / "Czech Republic") are merged by ISO code
- Uses a self-updating offline city database so known locations are reused offline

## Architecture

The raw `Timeline.json` is too large (~100MB) to load directly in the browser. A preprocessing step extracts and computes derived datasets that the frontend loads on demand.

```
Timeline.json (raw Google export)
       │
       ▼
 scripts/preprocess.ts   ← Node.js preprocessing script
       │
       ▼
 public/data/*.json      ← Lightweight derived datasets
       │
       ▼
 React + Vite SPA        ← Static site, loads JSON via fetch
```

Because every page respects the global time range, the preprocessor emits **dated per-record data** rather than all-time totals, and the frontend (`src/aggregate.ts`) aggregates whatever falls inside the selected range. Every date is a **local calendar date**: where you were at the time, not where your phone's clock was set (see [Local Time](#local-time)).

### Local Time

The export writes all its timestamps in your phone's time zone, so a flight leaving San Francisco at 13:35 can read `22:35+01:00`. It also records the real UTC offset where every visit and every movement started and ended, and the preprocessor uses those offsets throughout:

- Stays, activities (including the hour-of-day and day-of-week statistics), routes, and flights are dated by the local date and time where they started; a flight's date is its local departure date, and the trip detail page shows local departure times
- Days present count each local calendar date a visit spans
- **Nights** are dated by the local evening they begin: the night of 14 March is 20:00 on the 14th to 08:00 on the 15th, local time wherever you were, spent at the place you were during most of that window. A night spent on a plane counts as a night away, at the airport you left from, so an overnight flight home still ends the trip the next morning
- Trips therefore run from the day you leave (the first night's date) to the day you get back (the morning after the last night)

### Generated Data Files

| File | Description |
|---|---|
| `home.json` | Detected home periods, oldest first: `{start, end, lat, lng, city, country}[]`, where `start`/`end` are the first/last night slept there and `end` is `null` for the current home (see [Home Periods](#home-periods)) |
| `flights.json` | All flight segments with coordinates, distance, duration, and path, plus the nearest-airport match at each end (`startAirport`/`endAirport: {iata, name} \| null`, see [Airport Data](#airport-data)) and an estimated `co2Kg` (see [CO2 Estimate](#co2-estimate)) |
| `visits.json` | Deduplicated places with visit counts, total time spent, resolved city/country name, and every dated stay (`stays: [date, seconds][]`) |
| `nights-away.json` | Per-night home/away classification (each night keyed by the local date of its evening), with distance from the home of that night's period |
| `geography.json` | Countries merged by ISO alpha-3 code (`countries: {country, iso3}[]`), the cities away nights resolved to (`cities`, each pointing at its country), the city of every away night (`nights: {date, city}[]`), and the countries present on every date (`presence: [date, countryIndices][]`) |
| `trips.json` | Consecutive away-nights grouped into trips (distances from the home at the time) |
| `routes.json` | All movement segments with polyline points and transport mode |
| `stats.json` | Column-oriented log of every activity (date, start hour, mode, distance, duration) that the statistics are computed from |

### Home Periods

People move, so the preprocessor detects a list of home periods instead of one fixed home. Google's `HOME` / `INFERRED_HOME` labels tell it *which* places were homes, but not reliably *when*: whole months go unlabelled, and a family home you stay at over Christmas gets labelled `INFERRED_HOME` too. So the labels only nominate candidates, and the timeline comes from where you actually slept:

1. **Candidate homes** — labelled visits are clustered by distance (within 1 km of each other). Distance rather than a coordinate grid, because a grid can split one home in two when it sits on a cell edge.
2. **Monthly evidence** — each month is labelled with the candidate you slept at (within 1 km) most nights that month. Months with no such nights, or a tie, stay unlabelled.
3. **Smoothing** — consecutive months with the same label form segments. The weakest segment shorter than `HOME_MIN_PERIOD_MONTHS` (default **5**) is dropped, again and again, until all segments are long enough. If a dropped segment sat between two segments of the same home, those two merge, and the months that interrupted them are subtracted from the merged total. So a Christmas at your parents', a summer away, or a three-month stint abroad stays a trip. Patchy early data that alternates between two places can't add up to a home either.
4. **Dates** — a period ends on the last night slept at its home (up to the next home's first month, since moves happen mid-month). The next period starts on the first night at the new home after that. The first period starts on the first night ever slept at its home. The latest period is ongoing (`end: null`).

Every night is then classified against the home of its period (more than 1 km away = a night away), and trips and the away-night geography follow. A night outside every period belongs to the **nearest period in time**, which covers nights before the first period and nights in the gap between moving out and moving in. When both periods are equally close, the earlier one wins. Days present are unaffected, since they don't depend on home.

Limitations: a new home only shows up once you've mostly slept there for `HOME_MIN_PERIOD_MONTHS` months. Until then those nights count as away. A place Google never labels as home can't become one. Lower `HOME_MIN_PERIOD_MONTHS` if you want shorter stays, like a semester abroad, to count as homes.

### World Country Geometry

`public/world-countries.geo.json` (~240 KB, committed) holds the country shapes for the Overview world map. It is [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 countries (public domain) — used instead of 1:110m so microstates like Andorra exist — simplified to roughly 1:110m detail:

```bash
npx mapshaper ne_50m_admin_0_countries.geojson -simplify 12% weighted keep-shapes \
  -o format=geojson precision=0.01
```

Each feature keeps only `iso3` (ISO 3166-1 alpha-3), a display `name`, and alternative `names`. The preprocessor matches geocoder country names against those names (plus a small alias table, `COUNTRY_ALIASES` in `scripts/preprocess.ts`, for variants like "USA" or "Türkiye") to attach ISO codes, and warns about any country it can't place on the map.

Days present counts every local calendar day with at least one recorded visit in a country, so home time, day trips, and airport layovers all count, and a travel day counts for both countries. `geography.json` stores which countries were present on each date, so the map and the Geography table count days present for whatever time range is selected.

### Airport Data

`scripts/data/airports.json` (~570 KB, committed) is a trimmed, vendored copy of [OurAirports](https://ourairports.com/data/)' `airports.csv` export (public domain / Unlicense), used to name each flight's nearest airport. It keeps only `large_airport` and `medium_airport` rows that have an IATA code, and only the fields the app needs: `iata`, `name`, `lat`, `lng`, `municipality`, and `size` (`large`/`medium`, used to break near-ties — see below). Like the offline city database and the world country geometry, it's read from disk only: no network fetch at preprocess or app runtime.

Regenerate it (a one-off, manual step — not part of `npm run preprocess`) with:

```bash
npx tsx scripts/generate-airports.ts
```

That script downloads the current `airports.csv` from OurAirports, so it's the one place in this project that makes a network request; see its header comment for details.

For each flight, preprocess finds the nearest airport to its start/end coordinates within 40 km, preferring a `large` airport over a `medium` one on a near-tie (a large airport gets a 5 km "discount" when scoring candidates, so a major hub a few km farther away still wins over a closer small field). A flight endpoint with no airport within 40 km gets `null` and the frontend falls back to the resolved city name.

### CO2 Estimate

Each flight in `flights.json` gets an estimated `co2Kg`: kg CO2e (economy class, per passenger), computed in `scripts/preprocess.ts` (`estimateFlightCo2Kg`) as:

1. **Flown distance** = great-circle distance between the flight's endpoints + a fixed **95 km detour correction** (real routes aren't great circles — airway routing, holding, weather).
2. A **per-km factor** (kg CO2/km, excluding radiative forcing) by haul, bucketed on the *raw* great-circle distance:
   - short (< 1,500 km): **0.15100** kg/km
   - medium (1,500–4,000 km): **0.13402** kg/km
   - long (> 4,000 km): **0.11704** kg/km

   The short and long figures are UK DEFRA/DESNZ's 2024 "Government greenhouse gas conversion factors for company reporting" economy-class passenger-flight factors (excl. RF) for international short-haul (< 3,700 km) and long-haul (> 3,700 km) respectively. DEFRA doesn't publish a medium-haul band; the medium figure here is the midpoint of the other two, as a simple model of the gradual efficiency gain from a longer cruise phase.
3. Multiply by a **radiative-forcing multiplier of 1.9** (DEFRA's own RF uplift, ~1.891, commonly rounded to 1.9) to account for aviation's non-CO2 warming effects (contrails, NOx, cirrus formation).

This is a simple distance-based estimate, not a per-aircraft/load-factor model — treat it as indicative. Source: DEFRA/DESNZ "2024 Government greenhouse gas conversion factors for company reporting", Passenger flights table.

### Offline City Database

The preprocessor maintains a committed offline database at `scripts/data/offline-city-db.json`.

Resolution order for each location:
1. Exact coordinate bucket hit in offline DB
2. Online reverse geocoding (Nominatim) when enabled
3. Nearest known city fallback from offline DB/seed data

When online lookup resolves a previously unseen location, it is automatically written back to the offline DB. This means the database keeps improving over time and future preprocess runs can resolve more locations without internet.

Environment variables for preprocess (all optional):

| Variable | Default | Purpose |
|---|---:|---|
| `CITY_DB_ENABLE_ONLINE` | `1` | Enable/disable online Nominatim lookups (`0` disables) |
| `CITY_DB_MAX_ONLINE_LOOKUPS` | `80` | Max online geocoding calls per preprocess run |
| `CITY_DB_ONLINE_TIMEOUT_MS` | `4000` | Per-request timeout for online geocoding |
| `CITY_DB_ONLINE_RPS` | `1` | Throttle for online calls (requests per second; Nominatim's usage policy allows at most 1) |
| `CITY_DB_REFRESH_FALLBACK` | `1` | Retry existing fallback entries via online geocoding |
| `CITY_DB_BUCKET_DEG` | `0.1` | Coordinate bucket size used for dedup/cache keys |
| `CITY_DB_USER_AGENT` | `timeline-visualizer/1.0 (offline-db-auto-update)` | User-Agent header for Nominatim requests |
| `HOME_MIN_PERIOD_MONTHS` | `5` | Months (net) a place must be where you slept most to count as a home period (see [Home Periods](#home-periods)) |

Examples:

```bash
# Fully offline preprocess (no internet lookups)
CITY_DB_ENABLE_ONLINE=0 npm run preprocess

# Allow more online lookups for one run
CITY_DB_MAX_ONLINE_LOOKUPS=300 npm run preprocess
```

## Tech Stack

| Library | Purpose |
|---|---|
| [React 19](https://react.dev/) | UI framework |
| [Vite 6](https://vite.dev/) | Build tool and dev server |
| [TypeScript 5](https://www.typescriptlang.org/) | Type safety |
| [Tailwind CSS 3](https://tailwindcss.com/) | Utility-first styling (dark theme) |
| [Leaflet](https://leafletjs.com/) + [React Leaflet](https://react-leaflet.js.org/) | Interactive maps |
| [Recharts](https://recharts.org/) | Charts and graphs |
| [tsx](https://github.com/privatenumber/tsx) | Run TypeScript preprocessing script directly |
| [ESLint](https://eslint.org/) (typescript-eslint + react-hooks) | Linting |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Google Maps Timeline export (`Timeline.json`) placed in the project root

### How to Get Your Timeline Data

Google moved Timeline data **on-device** in 2024 — the old Google Takeout "Location History" export no longer works. Export from your phone instead:

- **Android**: Settings → Location → Location Services → Timeline → **Export Timeline data**, or in the Google Maps app: profile picture → Your Timeline → ⋯ → Location & privacy settings → Export Timeline data
- **iOS**: Google Maps app → profile picture → Your Timeline → ⋯ → Location & privacy settings → Export Timeline data

Transfer the resulting `Timeline.json` to this project's root directory. The expected format is the on-device export with a top-level `semanticSegments` array (extra keys like `rawSignals` are ignored).

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Preprocess your timeline data (Timeline.json → public/data/*.json)
npm run preprocess

# 3. Start the dev server → http://localhost:5173
npm run dev
```

Re-run `npm run preprocess` whenever you update your `Timeline.json` export.

## All Commands

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm run preprocess` | Process `Timeline.json` → `public/data/*.json` |
| `npm run dev` | Start dev server at localhost:5173 |
| `npm run build` | TypeScript check + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check `src/` and `scripts/` without emitting |
| `npm run lint` | Lint `src/` and `scripts/` with ESLint |

The production build in `dist/` is a static site deployable to any static host — but remember `public/data/` contains your personal location history, so only deploy somewhere private.

## Project Structure

```
timeline-visualizer/
├── scripts/
│   ├── preprocess.ts          # Data pipeline: Timeline.json → derived JSONs
│   ├── generate-airports.ts   # One-off: regenerates scripts/data/airports.json from OurAirports
│   └── data/
│       ├── offline-city-db.json # Committed offline city/country resolver DB
│       └── airports.json      # Committed, trimmed OurAirports data (nearest-airport matching)
├── public/
│   ├── world-countries.geo.json # Vendored country shapes for the world map (Natural Earth)
│   └── data/                  # Generated data files (gitignored)
├── src/
│   ├── main.tsx               # App entry point, renders root component
│   ├── App.tsx                # Root component: top-bar nav links + page switch driven by the URL
│   ├── route.ts               # URL hash store: page, time range, and per-page state (no router library)
│   ├── types.ts               # TypeScript interfaces for all data shapes
│   ├── constants.ts           # Shared transport-mode colors/labels, chart styles
│   ├── timeRange.ts           # Global time range: selection model, URL params, context, date/period helpers
│   ├── aggregate.ts           # Range-aware aggregations (modes, places, trips, geography, homes, series)
│   ├── trip.ts                # Trip detail: finds a trip by date, derives its map, nights, cities, flights
│   ├── flight.ts              # Great-circle arcs and duration formatting for flights
│   ├── index.css              # Tailwind directives and global styles
│   ├── hooks/
│   │   └── useData.ts         # Cached fetch hooks for each data file
│   ├── components/
│   │   ├── StatCard.tsx       # Reusable metric card (icon, value, label, subtitle)
│   │   ├── Loader.tsx         # Animated loading spinner
│   │   ├── EmptyState.tsx     # "Run npm run preprocess" guidance when data is missing
│   │   ├── TimeRangeProvider.tsx # Provides the global range (read from the URL) above the page switch
│   │   ├── TimeRangeControl.tsx  # Top-bar range picker (presets + custom dates)
│   │   ├── NoDataInRange.tsx  # Hint shown when the selected range is empty
│   │   ├── CalendarHeatmap.tsx # GitHub-style year calendar heatmap grid
│   │   ├── VisitedCountriesMap.tsx # Visited-countries choropleth (Overview)
│   │   └── FirstsAndStreaks.tsx # New countries/cities per year, travel/home streaks, firsts (Statistics)
│   └── pages/
│       ├── Overview.tsx       # Dashboard home with stat cards and summary charts
│       ├── Flights.tsx        # Flight log table + great-circle arc map
│       ├── Geography.tsx      # Countries/cities by days spent
│       ├── NightsAway.tsx     # Calendar heatmap + trip list
│       ├── TripDetail.tsx     # One trip: map, night-by-night stops, cities, flights
│       ├── TravelMap.tsx      # Full-screen map with route/mode/place layers
│       └── Statistics.tsx     # Detailed charts, patterns, and top places
├── package.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Roadmap

Planned improvements, roughly in priority order. When one is implemented, remove it here and describe it in [Features](#features):

- **In-browser import** — drag-and-drop `Timeline.json` and preprocess in a Web Worker, removing the Node step entirely (data still never leaves your machine)
- **Family-home option** — mark a place (e.g. a family home you visit every year) as never "away", so recurring stays there don't count as trips; complements home periods
- **Animated playback** — scrub through time and watch your travel history draw itself
- **Year-vs-year comparison** view
- Tests (Vitest) for the preprocessing pipeline's pure helpers, plus CI

## Privacy

All data processing happens locally on your machine. The only external requests are for map tiles (CARTO dark basemap) and optional Nominatim reverse geocoding during preprocessing (coordinates only, rate-limited); the world map's country borders ship with the app. Your timeline data is never uploaded anywhere. `Timeline.json` and `public/data/` are gitignored so your location history can't be committed accidentally.
