# 🌍 Timeline Visualizer

A personal travel dashboard that transforms your Google Maps Timeline export into rich, interactive visualizations. Explore your flights, trips, nights away from home, movement patterns, and more — all running locally in your browser.

## Features

### 📊 Overview Dashboard
- At-a-glance stat cards: total flights, nights away, unique places visited, total distance traveled, walking/cycling totals, and trip count
- "Times around the Earth" distance comparison
- Yearly bar charts for flights taken and nights spent away
- Transport mode pie chart and distance breakdown
- Longest and furthest trip highlights

### ✈️ Flights
- Full log of every flight detected in your timeline data
- Sortable table by date, distance, or duration with year filter
- Interactive world map with **great-circle arcs** for each flight route
- Origin/destination coordinate markers with resolved city names
- Summary stats: total flights, total distance, most repeated route, average duration

### 🌙 Nights Away from Home
- **GitHub-style calendar heatmap** — color-coded by distance from home (darker orange = further away)
- Year-by-year selector with per-year count and percentage
- Auto-detection of **home location** from Google's `INFERRED_HOME` data
- Automatically grouped **trip list** showing dates, number of places, distance from home, and night count
- All-time stats: total nights away, total trips, longest trip, furthest trip

### 🗺️ Travel Map
- Full-screen interactive Leaflet map with dark CARTO basemap
- Thousands of route segments rendered as polylines, **color-coded by transport mode** (flying, walking, cycling, driving, train, bus, subway, tram, ferry, motorcycle, sailing, skiing)
- Toggle individual transport modes on/off
- Year range filter (derived from your data) to explore specific time periods
- Place markers (top 500 visited locations) sized by visit frequency
- Home marker with permanent label

### 📈 Statistics
- Distance and activity count by transport mode (horizontal bar charts, individually colored)
- Yearly distance traveled (line chart) and unique places per year (bar chart)
- Day-of-week radar chart showing activity distribution
- Hour-of-day bar chart for movement patterns
- Top 20 most visited places table with coordinates, semantic type, visit count, and hours spent

### 🧭 Geography
- Countries and cities ranked by total away-days, with summary cards and full share-of-total tables
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

### Generated Data Files

| File | Description |
|---|---|
| `home.json` | Auto-detected home coordinates (from `INFERRED_HOME` / `HOME` visits) |
| `flights.json` | All flight segments with coordinates, distance, duration, and path |
| `visits.json` | Deduplicated places with visit counts and total time spent |
| `nights-away.json` | Per-date home/away classification with distance from home |
| `geography.json` | Countries/cities ranked by away-days spent there |
| `trips.json` | Consecutive away-nights grouped into trips |
| `routes.json` | All movement segments with polyline points and transport mode |
| `stats.json` | Pre-computed aggregates: yearly trends, distance by mode, top places, activity patterns |

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
│   └── data/
│       └── offline-city-db.json # Committed offline city/country resolver DB
├── public/
│   └── data/                  # Generated data files (gitignored)
├── src/
│   ├── main.tsx               # App entry point, renders root component
│   ├── App.tsx                # Root component with top-bar page navigation
│   ├── types.ts               # TypeScript interfaces for all data shapes
│   ├── constants.ts           # Shared transport-mode colors/labels, chart styles
│   ├── index.css              # Tailwind directives and global styles
│   ├── hooks/
│   │   └── useData.ts         # Cached fetch hooks for each data file
│   ├── components/
│   │   ├── StatCard.tsx       # Reusable metric card (icon, value, label, subtitle)
│   │   ├── Loader.tsx         # Animated loading spinner
│   │   ├── EmptyState.tsx     # "Run npm run preprocess" guidance when data is missing
│   │   └── CalendarHeatmap.tsx # GitHub-style year calendar heatmap grid
│   └── pages/
│       ├── Overview.tsx       # Dashboard home with stat cards and summary charts
│       ├── Flights.tsx        # Flight log table + great-circle arc map
│       ├── Geography.tsx      # Countries/cities by days spent
│       ├── NightsAway.tsx     # Calendar heatmap + trip list
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

Planned improvements, roughly in priority order:

- **Visited-countries world map** — choropleth on the Overview page with every visited country highlighted (color intensity by days spent)
- **Global time-range filter** — pick a date range once and have every page's stats, charts, and maps reflect only that period
- **URL routing & shareable state** — hash-based routing so page/year selections survive reloads and can be bookmarked
- **Trip detail view** — click a trip to see its own map, cities visited, and flights taken during it
- **Place name resolution** — show resolved city names (via the offline city DB) instead of raw place IDs in top-places tables and map tooltips
- **In-browser import** — drag-and-drop `Timeline.json` and preprocess in a Web Worker, removing the Node step entirely (data still never leaves your machine)
- **Multi-home support** — home periods over time instead of a single static home, for people who have moved
- **Timezone-aware night bucketing** — use the export's UTC-offset fields instead of UTC midnight
- **Firsts & streaks** — new countries/cities per year, longest travel streak, longest home streak
- **Flight extras** — nearest-airport naming (OurAirports data) and CO₂ estimates
- **Animated playback** — scrub through time and watch your travel history draw itself
- **Year-vs-year comparison** view
- Tests (Vitest) for the preprocessing pipeline's pure helpers, plus CI

## Privacy

All data processing happens locally on your machine. The only external requests are for map tiles (CARTO dark basemap) and optional Nominatim reverse geocoding during preprocessing (coordinates only, rate-limited). Your timeline data is never uploaded anywhere. `Timeline.json` and `public/data/` are gitignored so your location history can't be committed accidentally.
