# 🌍 Timeline Visualizer

A personal travel dashboard that transforms your Google Maps Timeline export into rich, interactive visualizations. Explore your flights, trips, nights away from home, movement patterns, and more — all running locally in your browser. Drop your `Timeline.json` on the page and the dashboard builds itself; nothing is uploaded.

## Features

Everything you can currently see and do with the tool, page by page.

### 📥 In-Browser Import

- **Drag and drop your `Timeline.json`** onto the dashboard (or pick it with the file chooser): it's processed right in your browser, in a background thread (a Web Worker) so the page stays responsive. No Node.js step needed; a 13-year, 83 MB export takes about a second on a desktop
- **Nothing leaves your machine**: the file is read and processed locally, and cities are resolved with the offline city database that ships with the app, never by asking an online service (see [Offline City Database](#offline-city-database))
- Phase-by-phase progress (reading, parsing, visits, cities, flights, nights, home periods, geography, trips, activities, routes, saving), with a Cancel button
- The result is **kept in your browser** (IndexedDB), so it's there on every reload until you clear it. A footer on every page but the full-screen Travel Map names where the data came from, with **Re-import** (for a newer export) and **Clear imported data**
- Optional [family homes](#family-homes): paste or load a `timeline-config.json` at import time; it's validated as you type and kept in the browser with the imported data
- Readable errors instead of a blank page: a JSON file that isn't a Timeline export, the old Google Takeout formats, a ZIP archive, an empty, truncated or malformed file, a file too large for the browser, running out of memory, or the browser refusing to store the result
- The same data as the command-line [`npm run preprocess`](#command-line-preprocessing): both run the same pipeline code, and an import is byte-identical to an offline command-line run (`CITY_DB_ENABLE_ONLINE=0`) of the same export and config. When both exist, **the browser import wins** over `public/data/`; clearing it falls back to `public/data/`
- The dashboard itself still runs from `npm run dev` (or any static host serving a build); what's gone is the separate Node preprocessing step

### 📅 Global Time Range

- One **date-range picker in the top bar**, visible on every page: pick a period once and every stat card, chart, table, heatmap, and map shows only that period
- Presets for **All time** (the default), **Last 12 months** (up to your newest data), and **each year** in your data, plus **custom start/end dates** (leave one side empty for an open-ended range)
- The selection persists while you switch pages and is kept in the URL (see [Shareable Links &amp; History](#-shareable-links--history)); the ✕ next to the picker resets to All time
- Trend charts adapt their granularity: per year for long ranges, **per month** for ranges up to three years
- Day-precise: every number is recomputed from dated per-record data, so a custom range is exact rather than rounded to whole months, and All time reproduces the unfiltered totals exactly
- Time-zone aware: every date is the local date wherever you were, not your phone's clock (see [Local Time](#local-time))
- A "no data in this range" hint (with a one-click reset) instead of empty charts when a period has nothing recorded

### 🔗 Shareable Links & History

- Every view has its own URL: the page, the time range, and per-page view settings live in the address bar's `#` hash, so **a reload restores exactly what you were looking at**, and a bookmark or shared link reproduces it (the URL holds view settings only, never your data, so a link opens wherever your copy of the dashboard runs)
- One path per page: `#/overview`, `#/flights`, `#/nights`, `#/map`, `#/statistics`, `#/geography`, `#/compare`, plus one per trip, named by its first night: `#/trip?start=2024-03-14`
- Time range as compact parameters: `?range=2024` (a year), `?range=last12m`, or `?from=2024-03-01&to=2024-06-30` (either side may be left out); All time adds nothing
- Per-page settings: Flights sort order (`sort=distance` or `sort=duration`, `dir=asc`), the Nights Away year (`year=2023`), Travel Map layers (`show=walking`, `hide=flying,in_bus`, `places=off`), whether the Travel Map player is open (`playback=on`), and the Compare page's two years (`a=2024&b=2025`, ignoring the global range — see [Compare Years](#-compare-years)), e.g. `#/flights?range=2024&sort=distance`
- Only settings that differ from the defaults are written, so an untouched page stays a clean `#/overview`
- Browser **back/forward** step through page and time-range changes (typing a custom date range counts as one step); sorting, year picks, layer toggles, and opening the player update the current entry instead of piling up history
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
  - The page header lists the homes that apply to the selected range, e.g. "Utrecht, Netherlands (2016–2022) → Lyon, France (since 2022)"
- **Family homes** — mark places you keep going back to without living there, like your parents' house every Christmas, in an optional config file (see [Family Homes](#family-homes)). Nights there are never "away":
  - They don't count as nights away (totals, percentages, per-year charts, the away-night geography) and never form or extend a trip: a Christmas stay there is no trip at all, and a trip with a stopover there splits in two
  - They are their own kind of night, neither home nor away: a teal square on the calendar heatmap, their own count next to the nights away, and a line in the page header naming the family homes stayed at in the range
  - A family home you later move into is simply home from then on
- **GitHub-style calendar heatmap** — color-coded by distance from home (darker orange = further away), with family-home nights in teal; days outside the selected range are shown as outlines
- **Time-zone aware nights** — each night is dated by the local evening it begins and placed where you spent that local night (20:00–08:00), wherever in the world you were, and a night spent on a plane counts as a night away; a mid-trip tracking gap (no recorded stay between two away nights) counts as away at the last known place instead of splitting the trip (see [Local Time](#local-time))
- Year-by-year selector (years within the selected range) with per-year count and percentage
- Automatically grouped **trip list** showing dates, number of places, distance from home, and night count (trips that overlap the range, including ones that cross into it); click a trip (or Tab to it and press Enter) to open its [detail page](#-trip-detail)
- Range stats: total nights away, total trips, longest trip, furthest trip

### 🧳 Trip Detail

- One page per trip, opened from the Nights Away trip list or the Overview highlights, with its own shareable URL (`#/trip?start=2024-03-14`); browser back returns to where you came from, and **← Trips in 2024** goes to that year's trip list
- Header with the dates, nights away, return day, farthest distance from home (and where), cities, countries, places visited, total distance traveled, and flights taken
- **Trip map** (dark Esri basemap, fitted to the trip): ground routes color-coded by transport mode, flights as great-circle arcs, where each night was spent (sized by nights), the other places visited, and home (or the family home the trip left from); the legend lists the distance covered per mode
- A trip that ends at a family home says so ("then 🏡 Grandma's from …") instead of "back home"
- **Night by night**: a square per night colored by distance from home (hover for the city and distance), then the nights grouped into stops, e.g. "Annecy, France · 3 nights"
- **Cities & countries** with nights spent in each and days present, plus the countries passed through without staying the night (layovers, day trips)
- **Flights** taken during the trip, in order, with local departure time, IATA route labels (city as a sub-label), distance, and duration
- Always shows the whole trip, whatever the global time range (the picker stays usable and a small note says so); everything is computed from the trip's dates, from its departure day to the day it got back

### 🗺️ Travel Map

- Full-screen interactive Leaflet map with dark Esri basemap
- Thousands of route segments drawn on a canvas, **color-coded by transport mode** (flying, walking, cycling, driving, train, bus, subway, tram, ferry, motorcycle, sailing, skiing)
- Toggle individual transport modes on/off
- Place markers (top 500 locations visited in the selected range) sized by visit frequency within the range, with tooltips showing the resolved city/country name (via the offline city database) instead of raw place IDs
- A home marker for every home that applies to the selected range, labelled with the years you lived there (e.g. "Home 2016–2022", "Home since 2022")
- A teal ring for every [family home](#family-homes) stayed at in the selected range, labelled with its name
- **▶ Playback** — watch your travel history draw itself. The Playback button opens a player bar over the map that replays the selected range (all your data for All time) in chronological order:
  - Segments appear as the date passes their start. The newest glow wider and brighter for about a second before settling into their normal style, and a dot marks where the latest one ended, so your eye can follow the movement
  - Places and homes appear as they are first visited in the range, so the last frame is the usual map
  - Play/pause, a big current-date label (with the weekday and how many segments are drawn), and a scrubber spanning the range: click or drag anywhere to jump (playback pauses while you drag). A strip above it shows when you were on the move, filled in orange up to the current date
  - Speeds of 1 day, 1 week, 1 month, 3 months or 1 year per second. The default is the slowest that plays the whole range within a minute: 3 months/s for all time, 1 week/s for a single year
  - Mode toggles, the Places layer and the time-range picker keep working mid-playback; a new range keeps the current date if it falls inside it, otherwise playback jumps to the nearest end of the new range
  - Keyboard, while the bar has focus: **Space** play/pause, **←/→** step a day, **Shift+←/→** step one second's worth at the current speed, **Home/End** jump to the ends
  - Whether the player is open is part of the URL (`playback=on`), the position is not: a shared link opens the player at the start of the range

### 📈 Statistics

- Distance, time spent, and activity count by transport mode (horizontal bar charts, individually colored)
- Distance traveled (line chart) and unique places visited (bar chart) per year, or per month for shorter ranges
- Day-of-week radar chart showing activity distribution
- Hour-of-day bar chart for movement patterns, in local time wherever you were
- Top 20 most visited places in the range, showing resolved city/country name (via the offline city database, with coordinates as a sub-label), semantic type, visit count, and hours spent
- **🏆 Firsts & Streaks**, at the bottom of the page:
  - **New countries/cities per year** — each country/city's *lifetime* first-visit year (from all-time data, not the selected range), listed as chip rows per year with an expandable list for long years; the selected range only limits which years are shown, it never changes which year counts as "new"
  - **Longest travel streak** and **longest home streak** — the longest run of consecutive nights away from / at home, computed for the selected range and clipped at its edges like every other range-aware number in the app; a night with no tracked location data ends a streak, and so does a night at a family home (it is neither), and the travel streak also lists the distinct cities visited during it
  - **Firsts stat cards** — first flight on record, farthest-ever single night from home, and the year with the most newly visited countries (all all-time, like the per-year lists above)

### 🧭 Geography

- Countries and cities ranked by away-days in the selected range, with summary cards and full share-of-total tables
- Country table also lists **days present** in the range (home time included), the measure behind the Overview world map
- Country name variants from different sources ("USA" / "United States", "Czechia" / "Czech Republic") are merged by ISO code
- Uses a self-updating offline city database so known locations are reused offline

### ⚖️ Compare Years

- Two full calendar years, side by side, with its own shareable URL (`#/compare?a=2024&b=2025`); year pickers default to the two most recent **full** years in your data (fully covered start-to-end), with a swap button
- **Ignores the global time range** (the picker stays usable and a small note says so, the same pattern as the trip detail page) — a year here is always compared in full, whatever period is selected elsewhere
- **Side-by-side stat rows** with delta badges (an arrow plus a percent, or "+N" when the earlier year was zero): total distance, flights, flight distance, estimated CO₂, nights away and the percentage of the year spent away, trips, unique places, countries/cities visited, and new countries/cities that year (each a *lifetime* first-visit year, like the Statistics page's Firsts & Streaks)
- **Distance by mode**, as both stat rows and a grouped horizontal bar chart, for the top modes by combined distance across both years
- **Overlaid monthly charts** — distance and nights away, month-of-year on the x-axis, one line per year — so seasonal patterns line up even when the two years are far apart
- Year A is always orange, Year B always sky-blue, consistently across every row and chart on the page

## Architecture

The raw `Timeline.json` is large (~100 MB) and slow to crunch, so it's processed once into small derived datasets (a few MB) that the dashboard reads. That processing is one shared, environment-agnostic **pipeline** (`src/pipeline/`), run either in your browser or from the command line:

```
            In the browser (default)            Command line (optional)
            ────────────────────────            ───────────────────────
            drop Timeline.json on the page      npm run preprocess
                        │                                   │
                        ▼                                   ▼
            src/import/worker.ts                scripts/preprocess.ts
            Web Worker, offline-only            Node; optional online city
                        │                       lookups + city-DB write-back
                        │                                   │
                        ├──── src/pipeline/ (shared) ───────┤
                        ▼                                   ▼
            IndexedDB (this browser)            public/data/*.json
                        │                                   │
                        └────────► src/hooks/useData.ts ◄───┘
                             (the import wins if both exist)
                                             │
                                             ▼
                                  React + Vite SPA pages
```

- **The pipeline** takes the parsed export plus the committed reference data (offline city database, airports, world-country names) and an optional family-home config, and returns every dataset. It has no file system, network, DOM or Node dependencies (a dedicated TypeScript config checks that), so the same code runs in both places, and it defines the datasets' TypeScript types that the frontend uses.
- **In the browser**, a Web Worker reads and parses the file, runs the pipeline with city resolution offline-only, and hands back each dataset as JSON text; the page stores it in IndexedDB.
- **On the command line**, `npm run preprocess` reads the files and environment variables, can plug in online Nominatim lookups (which also grow the committed offline city database), and writes `public/data/*.json`.

Because every page respects the global time range, the pipeline emits **dated per-record data** rather than all-time totals, and the frontend (`src/aggregate.ts`) aggregates whatever falls inside the selected range. Every date is a **local calendar date**: where you were at the time, not where your phone's clock was set (see [Local Time](#local-time)).

### Local Time

The export writes all its timestamps in your phone's time zone, so a flight leaving San Francisco at 13:35 can read `22:35+01:00`. It also records the real UTC offset where every visit and every movement started and ended, and the pipeline uses those offsets throughout:

- Stays, activities (including the hour-of-day and day-of-week statistics), routes, and flights are dated by the local date and time where they started; a flight's date is its local departure date, and the trip detail page shows local departure times
- Days present count each local calendar date a visit spans
- **Nights** are dated by the local evening they begin: the night of 14 March is 20:00 on the 14th to 08:00 on the 15th, local time wherever you were, spent at the place you were during most of that window. A night spent on a plane counts as a night away, at the airport you left from, so an overnight flight home still ends the trip the next morning
- A night with no recorded stay at all defaults to a night at home — except mid-trip: when the nearest located nights on both sides are away (an overnight bus, a dead phone abroad), the gap counts as away at the last known place, so one tracking gap doesn't split a trip in two. A located night at home or at a family home still ends the trip
- Trips therefore run from the day you leave (the first night's date) to the day you get back (the morning after the last night)

### Generated Data Files

The pipeline produces these datasets. `npm run preprocess` writes them as files to `public/data/`; the in-browser import keeps the same JSON text in IndexedDB (database `timeline-visualizer`, one record per dataset). Their TypeScript types live in `src/pipeline/types.ts`.

| File                  | Description                                                                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home.json`         | Detected home periods, oldest first:`{start, end, lat, lng, city, country}[]`, where `start`/`end` are the first/last night slept there and `end` is `null` for the current home (see [Home Periods](#home-periods))                                                                       |
| `flights.json`      | All flight segments with coordinates, distance, duration, and path, plus the nearest-airport match at each end (`startAirport`/`endAirport: {iata, name} \| null`, see [Airport Data](#airport-data)) and an estimated `co2Kg` (see [CO2 Estimate](#co2-estimate))                               |
| `visits.json`       | Deduplicated places with visit counts, total time spent, resolved city/country name, and every dated stay (`stays: [date, seconds][]`)                                                                                                                                                            |
| `nights-away.json`  | Per-night home/away classification (each night keyed by the local date of its evening), with distance from the home of that night's period; nights at a family home are not away (`isHome: true`) and carry the family home's label (`family`)                                                  |
| `family-homes.json` | The family homes from`timeline-config.json`: `{label, lat, lng, radiusKm}[]`, `[]` without a config (see [Family Homes](#family-homes))                                                                                                                                                        |
| `geography.json`    | Countries merged by ISO alpha-3 code (`countries: {country, iso3}[]`), the cities away nights resolved to (`cities`, each pointing at its country), the city of every away night (`nights: {date, city}[]`), and the countries present on every date (`presence: [date, countryIndices][]`) |
| `trips.json`        | Consecutive away-nights grouped into trips (distances from the home at the time)                                                                                                                                                                                                                    |
| `routes.json`       | All movement segments with polyline points and transport mode                                                                                                                                                                                                                                       |
| `stats.json`        | Column-oriented log of every activity (date, start hour, mode, distance, duration) that the statistics are computed from                                                                                                                                                                            |

### Home Periods

People move, so the pipeline detects a list of home periods instead of one fixed home. Google's `HOME` / `INFERRED_HOME` labels tell it *which* places were homes, but not reliably *when*: whole months go unlabelled, and a family home you stay at over Christmas gets labelled `INFERRED_HOME` too. So the labels only nominate candidates, and the timeline comes from where you actually slept:

1. **Candidate homes** — labelled visits are clustered by distance (within 1 km of each other). Distance rather than a coordinate grid, because a grid can split one home in two when it sits on a cell edge.
2. **Monthly evidence** — each month is labelled with the candidate you slept at (within 1 km) most nights that month. Months with no such nights, or a tie, stay unlabelled.
3. **Smoothing** — consecutive months with the same label form segments. The weakest segment shorter than `HOME_MIN_PERIOD_MONTHS` (default **5**) is dropped, again and again, until all segments are long enough. If a dropped segment sat between two segments of the same home, those two merge, and the months that interrupted them are subtracted from the merged total. So a Christmas at your parents', a summer away, or a three-month stint abroad stays a trip. Patchy early data that alternates between two places can't add up to a home either.
4. **Dates** — a period ends on the last night slept at its home (up to the next home's first month, since moves happen mid-month). The next period starts on the first night at the new home after that. The first period starts on the first night ever slept at its home. The latest period is ongoing (`end: null`).

Every night is then classified against the home of its period (more than 1 km away = a night away, unless it was at a [family home](#family-homes)), and trips and the away-night geography follow. A night outside every period belongs to the **nearest period in time**, which covers nights before the first period and nights in the gap between moving out and moving in. When both periods are equally close, the earlier one wins. Days present are unaffected, since they don't depend on home.

Limitations: a new home only shows up once you've mostly slept there for `HOME_MIN_PERIOD_MONTHS` months. Until then those nights count as away. A place Google never labels as home can't become one. Lower `HOME_MIN_PERIOD_MONTHS` if you want shorter stays, like a semester abroad, to count as homes.

### Family Homes

Home periods keep a place you only visit, however often, from becoming home: a month at your parents' every Christmas and summer stays a string of trips. If you'd rather not count those stays as travel, list the place as a **family home** in an optional config in this format:

```json
{
  "familyHomes": [
    { "lat": 48.8584, "lng": 2.2945, "label": "Parents' house" },
    { "lat": 43.2965, "lng": 5.3698, "label": "Grandma's", "radiusKm": 2 }
  ]
}
```

| Field            | Required | Meaning                                                                                              |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `lat`, `lng` | yes      | The place, in degrees (e.g. from "What's here?" in Google Maps)                                      |
| `label`        | no       | Name shown in the dashboard; defaults to the city the place is in                                    |
| `radiusKm`     | no       | Nights spent within this distance count as spent there; default**1** (the same radius as home) |

Where the config goes depends on how you process your export:

- **In the browser**: open **🏡 Family homes (optional)** under the drop zone (or in the footer's Re-import dialog), paste the JSON or load a `timeline-config.json`, then drop your `Timeline.json`. It's checked as you type, stored in your browser with the imported data (prefilled on the next re-import, removed by Clear imported data), and never uploaded.
- **On the command line**: save it as `timeline-config.json` in the project root, next to `Timeline.json` (copy `timeline-config.example.json` to get started), and re-run `npm run preprocess`. The file is gitignored, since it holds personal coordinates.

Without a config (or with an empty `familyHomes` list) nothing changes: every night, trip and number comes out exactly as it would without the feature, and `family-homes.json` is empty.

How it works:

- A night that would be away but was spent within `radiusKm` of a family home is a **family-home night** instead: not away and not home. When several family homes are in range, the nearest wins.
- Its distance from home is still measured from the home of its period, so a family home 1,500 km away still shows as 1,500 km from home in tooltips.
- Trips are runs of consecutive nights away, and a family-home night ends a run just like a night at home. A stay that is all at the family home is no trip at all, and a trip with a stopover there splits into the part before and the part after: a summer drive through France to your parents', then on to Portugal, is a France trip and a Portugal trip, with the stay at your parents' in between belonging to neither.
- Away-night countries and cities (Geography, the world map's nights) leave family-home nights out too. Days present don't change, since they don't depend on home.
- Only nights that would otherwise be away are affected: when a family home is the home of the period (you moved in, and home periods picked it up), its nights are plain home nights. So the same place can be a family home for years and your home afterwards.

### World Country Geometry

`public/world-countries.geo.json` (~240 KB, committed) holds the country shapes for the Overview world map. It is [Natural Earth](https://www.naturalearthdata.com/) 1:50m admin-0 countries (public domain) — used instead of 1:110m so microstates like Andorra exist — simplified to roughly 1:110m detail:

```bash
npx mapshaper ne_50m_admin_0_countries.geojson -simplify 12% weighted keep-shapes \
  -o format=geojson precision=0.01
```

Each feature keeps only `iso3` (ISO 3166-1 alpha-3), a display `name`, and alternative `names`. The pipeline matches geocoder country names against those names (plus a small alias table, `COUNTRY_ALIASES` in `src/pipeline/countries.ts`, for variants like "USA" or "Türkiye") to attach ISO codes, and `npm run preprocess` warns about any country it can't place on the map. (The in-browser import fetches this same file from the app itself to read the names.)

Days present counts every local calendar day with at least one recorded visit in a country, so home time, day trips, and airport layovers all count, and a travel day counts for both countries. `geography.json` stores which countries were present on each date, so the map and the Geography table count days present for whatever time range is selected.

### Airport Data

`scripts/data/airports.json` (~570 KB, committed) is a trimmed, vendored copy of [OurAirports](https://ourairports.com/data/)' `airports.csv` export (public domain / Unlicense), used to name each flight's nearest airport. It keeps only `large_airport` and `medium_airport` rows that have an IATA code, and only the fields the app needs: `iata`, `name`, `lat`, `lng`, `municipality`, and `size` (`large`/`medium`, used to break near-ties — see below). Like the offline city database and the world country geometry, it ships with the project: `npm run preprocess` reads it from disk, and the in-browser import loads it from the app's own bundle (a separate chunk, loaded only when you import). Nothing is fetched from OurAirports at preprocess, import or app runtime.

Regenerate it (a one-off, manual step — not part of `npm run preprocess`) with:

```bash
npx tsx scripts/generate-airports.ts
```

That script downloads the current `airports.csv` from OurAirports (a one-off network request); see its header comment for details.

For each flight, the pipeline finds the nearest airport to its start/end coordinates within 40 km, preferring a `large` airport over a `medium` one on a near-tie (a large airport gets a 5 km "discount" when scoring candidates, so a major hub a few km farther away still wins over a closer small field). A flight endpoint with no airport within 40 km gets `null` and the frontend falls back to the resolved city name.

### CO2 Estimate

Each flight in `flights.json` gets an estimated `co2Kg`: kg CO2e (economy class, per passenger), computed in `src/pipeline/airports.ts` (`estimateFlightCo2Kg`) as:

1. **Flown distance** = great-circle distance between the flight's endpoints + a fixed **95 km detour correction** (real routes aren't great circles — airway routing, holding, weather).
2. A **per-km factor** (kg CO2/km, excluding radiative forcing) by haul, bucketed on the *raw* great-circle distance:

   - short (< 1,500 km): **0.15100** kg/km
   - medium (1,500–4,000 km): **0.13402** kg/km
   - long (> 4,000 km): **0.11704** kg/km

   The short and long figures are UK DEFRA/DESNZ's 2024 "Government greenhouse gas conversion factors for company reporting" economy-class passenger-flight factors (excl. RF) for international short-haul (< 3,700 km) and long-haul (> 3,700 km) respectively. DEFRA doesn't publish a medium-haul band; the medium figure here is the midpoint of the other two, as a simple model of the gradual efficiency gain from a longer cruise phase.
3. Multiply by a **radiative-forcing multiplier of 1.9** (DEFRA's own RF uplift, ~1.891, commonly rounded to 1.9) to account for aviation's non-CO2 warming effects (contrails, NOx, cirrus formation).

This is a simple distance-based estimate, not a per-aircraft/load-factor model — treat it as indicative. Source: DEFRA/DESNZ "2024 Government greenhouse gas conversion factors for company reporting", Passenger flights table.

### Offline City Database

Place names come from a committed offline database at `scripts/data/offline-city-db.json` (about 700 cities), plus a small built-in seed list.

Resolution order for each location:

1. Exact coordinate bucket hit in offline DB
2. Online reverse geocoding (Nominatim) — **command line only**, when enabled
3. Nearest known city fallback from offline DB/seed data

When an online lookup resolves a previously unseen location, `npm run preprocess` writes it back to the offline DB. This means the database keeps improving over time and future runs — command line and in-browser alike, since the app bundles the committed file — can resolve more locations without internet.

The database's online-resolved entries are derived from [OpenStreetMap](https://www.openstreetmap.org/copyright) data via Nominatim — © OpenStreetMap contributors, available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). Note that the committed file grows with the places *your* preprocess runs resolve, so committing it publishes the (city-level) set of areas your timeline touches — see [Privacy](#privacy).

The **in-browser import never looks anything up online**: it resolves cities from the bundled offline DB only (step 2 is skipped) and never writes the DB back. That keeps the privacy promise (your coordinates don't leave the browser) and Nominatim's usage policy. Places the DB doesn't cover get the nearest known city, exactly as in an offline command-line run (`CITY_DB_ENABLE_ONLINE=0`), whose output the import reproduces byte for byte. If your travels reach places the DB doesn't know, a command-line run with online lookups improves the DB; commit it, and later imports benefit too.

Environment variables for `npm run preprocess` (all optional):

| Variable                       |                                              Default | Purpose                                                                                                         |
| ------------------------------ | ---------------------------------------------------: | --------------------------------------------------------------------------------------------------------------- |
| `CITY_DB_ENABLE_ONLINE`      |                                                `1` | Enable/disable online Nominatim lookups (`0` disables)                                                        |
| `CITY_DB_MAX_ONLINE_LOOKUPS` |                                               `80` | Max online geocoding calls per preprocess run                                                                   |
| `CITY_DB_ONLINE_TIMEOUT_MS`  |                                             `4000` | Per-request timeout for online geocoding                                                                        |
| `CITY_DB_ONLINE_RPS`         |                                                `1` | Throttle for online calls (requests per second; Nominatim's usage policy allows at most 1)                      |
| `CITY_DB_REFRESH_FALLBACK`   |                                                `1` | Retry existing fallback entries via online geocoding                                                            |
| `CITY_DB_BUCKET_DEG`         |                                              `0.1` | Coordinate bucket size used for dedup/cache keys                                                                |
| `CITY_DB_USER_AGENT`         | `timeline-visualizer/1.0 (offline-db-auto-update)` | User-Agent header for Nominatim requests                                                                        |
| `HOME_MIN_PERIOD_MONTHS`     |                                                `5` | Months (net) a place must be where you slept most to count as a home period (see [Home Periods](#home-periods)) |

Examples:

```bash
# Fully offline preprocess (no internet lookups)
CITY_DB_ENABLE_ONLINE=0 npm run preprocess

# Allow more online lookups for one run
CITY_DB_MAX_ONLINE_LOOKUPS=300 npm run preprocess
```

## Tech Stack

| Library                                                                          | Purpose                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [React 19](https://react.dev/)                                                    | UI framework                                                       |
| [Vite 6](https://vite.dev/)                                                       | Build tool and dev server (also bundles the import Web Worker)     |
| [TypeScript 5](https://www.typescriptlang.org/)                                   | Type safety                                                        |
| [Tailwind CSS 3](https://tailwindcss.com/)                                        | Utility-first styling (dark theme)                                 |
| [Leaflet](https://leafletjs.com/) + [React Leaflet](https://react-leaflet.js.org/) | Interactive maps                                                   |
| [Recharts](https://recharts.org/)                                                 | Charts and graphs                                                  |
| Web Workers + IndexedDB (browser built-ins)                                      | In-browser import off the main thread, and storing its result      |
| [tsx](https://github.com/privatenumber/tsx)                                       | Run the TypeScript command-line preprocess directly                |
| [ESLint](https://eslint.org/) (typescript-eslint + react-hooks)                   | Linting                                                            |
| [Vitest](https://vitest.dev/)                                                     | Unit tests for the pipeline's pure helpers and`src/timeRange.ts` |
| [GitHub Actions](https://github.com/features/actions)                             | CI: typecheck, lint, test, build on every push/PR to`main`       |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+, to run the dashboard (dev server or production build)
- A Google Maps Timeline export (`Timeline.json`), see below
- A current desktop browser (Chrome, Edge, Firefox or Safari) for the in-browser import

### How to Get Your Timeline Data

Google moved Timeline data **on-device** in 2024 — the old Google Takeout "Location History" export no longer works. Export from your phone instead:

- **Android**: Settings → Location → Location Services → Timeline → **Export Timeline data**, or in the Google Maps app: profile picture → Your Timeline → ⋯ → Location & privacy settings → Export Timeline data
- **iOS**: Google Maps app → profile picture → Your Timeline → ⋯ → Location & privacy settings → Export Timeline data

Transfer the resulting `Timeline.json` to your computer. The expected format is the on-device export with a top-level `semanticSegments` array (extra keys like `rawSignals` are ignored).

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server → http://localhost:5173
npm run dev
```

3. Open http://localhost:5173 and **drop your `Timeline.json` onto the page** (or click *choose the file*). Optionally, open **🏡 Family homes** first to paste a family-home config (see [Family Homes](#family-homes)).
4. That's it: the dashboard appears once the import finishes, and it's still there the next time you open the page.

To update later, use **Re-import** in the page footer with a newer export. **Clear imported data** removes everything the import stored in your browser.

### Command-Line Preprocessing

The command line does the same processing from a terminal and writes the datasets to `public/data/*.json`, where the dashboard picks them up whenever this browser has no imported data. Reach for it when you want:

- **Online city lookups**: new places are resolved through OpenStreetMap's Nominatim (rate-limited) and written back to the committed offline city database, which later imports benefit from too (see [Offline City Database](#offline-city-database))
- **Huge exports**: a browser can read a file of at most about 500 MB in one piece, while Node can be given more memory (`NODE_OPTIONS=--max-old-space-size=8192 npm run preprocess`)
- **Scripting**, tuning knobs such as `HOME_MIN_PERIOD_MONTHS`, or a build with the data baked in

```bash
# Place Timeline.json in the project root, then:

# Optional: mark family homes (see "Family Homes"), then edit the copy
cp timeline-config.example.json timeline-config.json

# Timeline.json → public/data/*.json
npm run preprocess

# → http://localhost:5173
npm run dev
```

Re-run `npm run preprocess` whenever you update your `Timeline.json` export or `timeline-config.json`. If this browser also holds an in-browser import, that import wins; use **Clear imported data** in the footer to see `public/data/` instead.

## All Commands

| Command                | Description                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm install`        | Install dependencies                                                                                               |
| `npm run dev`        | Start dev server at localhost:5173                                                                                 |
| `npm run preprocess` | Optional, command-line alternative to the in-browser import:`Timeline.json` → `public/data/*.json`            |
| `npm run build`      | TypeScript checks + production build to`dist/`                                                                   |
| `npm run preview`    | Serve the production build locally                                                                                 |
| `npm run typecheck`  | Type-check`src/` and `scripts/`, plus `src/pipeline/` without DOM or Node types (`tsconfig.pipeline.json`) |
| `npm run lint`       | Lint`src/` and `scripts/` with ESLint                                                                          |
| `npm run test`       | Run the test suite once (Vitest)                                                                                   |
| `npm run test:watch` | Run the test suite in watch mode                                                                                   |

The production build in `dist/` is a static site deployable to any static host. Used with the in-browser import only, it contains no personal data: every visitor's import stays in their own browser. But `vite build` copies `public/data/` into `dist/`, so if you ran `npm run preprocess` before building, the build contains your location history; deploy that only somewhere private.

## Tests & CI

Vitest covers the pure, environment-agnostic pieces of the app: every helper in `src/pipeline/` (coordinate/local-time math, night bucketing, home-period detection, family homes, nearest-airport matching and the CO2 estimate, country/ISO matching) plus one end-to-end `runPipeline` smoke test on a tiny synthetic export, and the frontend's pure time-range helpers (`src/timeRange.ts`). Tests are colocated as `src/**/*.test.ts` and use only small, hand-built, synthetic fixtures (obviously fake coordinates and dates) — never `Timeline.json` or real personal data, which the suite never touches. `npm run test` runs them once; `npm run test:watch` re-runs on change.

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` on every push and pull request to `main`. `Timeline.json` and `public/data/` are gitignored, so CI never has personal data — the build succeeds without them, since `EmptyState` handles missing data at runtime.

## Project Structure

```
timeline-visualizer/
├── .github/
│   └── workflows/
│       └── ci.yml              # typecheck + lint + test + build, on every push/PR to main
├── scripts/
│   ├── preprocess.ts          # Command-line preprocess: files + env → shared pipeline → public/data/*.json
│   ├── nominatim.ts           # Rate-limited online reverse geocoding (command line only)
│   ├── generate-airports.ts   # One-off: regenerates scripts/data/airports.json from OurAirports
│   └── data/
│       ├── offline-city-db.json # Committed offline city/country resolver DB
│       └── airports.json      # Committed, trimmed OurAirports data (nearest-airport matching)
├── timeline-config.example.json # Example family-home config (copy to timeline-config.json, gitignored)
├── public/
│   ├── world-countries.geo.json # Vendored country shapes for the world map (Natural Earth)
│   └── data/                  # Command-line output (gitignored)
├── src/
│   ├── main.tsx               # App entry point, renders root component
│   ├── App.tsx                # Root component: top-bar nav links + page switch driven by the URL
│   ├── route.ts               # URL hash store: page, time range, and per-page state (no router library)
│   ├── types.ts               # Data types for the frontend (re-exports the pipeline's dataset types)
│   ├── constants.ts           # Shared transport-mode colors/labels, chart styles
│   ├── timeRange.ts           # Global time range: selection model, URL params, context, date/period helpers
│   ├── timeRange.test.ts      # Tests: inRange, yearRange, dayNumber/addDays across month/leap boundaries
│   ├── aggregate.ts           # Range-aware aggregations (modes, places, trips, geography, homes, series)
│   ├── trip.ts                # Trip detail: finds a trip by date, derives its map, nights, cities, flights
│   ├── flight.ts              # Great-circle arcs and duration formatting for flights
│   ├── routeIndex.ts          # routes.json packed into chronological typed arrays for drawing
│   ├── routeCanvas.ts         # Leaflet canvas layer drawing the Travel Map routes up to the playback time
│   ├── playback.ts            # Travel Map playback clock, speeds, and hooks
│   ├── index.css              # Tailwind directives and global styles
│   ├── pipeline/              # Shared, environment-agnostic processing (browser worker + CLI)
│   │   ├── index.ts           # Public API: runPipeline, validateTimeline, city DB helpers, types
│   │   ├── run.ts             # runPipeline: Timeline.json → every dataset, with progress callbacks
│   │   ├── types.ts           # Raw export, reference inputs, and dataset types (single source of truth)
│   │   ├── datasets.ts        # Dataset file names and pipeline phases
│   │   ├── cities.ts          # Offline city DB + CityResolver (optional online geocoder hook)
│   │   ├── countries.ts       # Country names → ISO codes (COUNTRY_ALIASES)
│   │   ├── homes.ts           # Home-period detection
│   │   ├── familyHomes.ts     # timeline-config.json validation, family-home matching
│   │   ├── airports.ts        # Nearest-airport matching and the CO2 estimate
│   │   ├── util.ts            # Coordinates, distances, calendar days, local time
│   │   └── *.test.ts          # Vitest: one file per module above, plus run.test.ts (end-to-end) and nights.test.ts (night bucketing)
│   ├── import/                # In-browser import
│   │   ├── worker.ts          # Web Worker: read + parse the file, run the pipeline offline-only
│   │   ├── importJob.ts       # The running import (progress, cancel, save), shared by all import UIs
│   │   ├── storage.ts         # IndexedDB: imported datasets, import meta, family-home config
│   │   └── protocol.ts        # Worker messages and import phases
│   ├── hooks/
│   │   └── useData.ts         # Cached data hooks: IndexedDB import if present, else public/data
│   ├── components/
│   │   ├── StatCard.tsx       # Reusable metric card (icon, value, label, subtitle)
│   │   ├── Loader.tsx         # Animated loading spinner
│   │   ├── EmptyState.tsx     # Shown when there's no data: the import drop zone
│   │   ├── ImportPanel.tsx    # Drop zone, file picker, family-home config, progress and errors
│   │   ├── DataFooter.tsx     # Data source line with Re-import (dialog) and Clear imported data
│   │   ├── RegenerateHint.tsx # "Import again or re-run preprocess" hint for outdated data
│   │   ├── TimeRangeProvider.tsx # Provides the global range (read from the URL) above the page switch
│   │   ├── TimeRangeControl.tsx  # Top-bar range picker (presets + custom dates)
│   │   ├── NoDataInRange.tsx  # Hint shown when the selected range is empty
│   │   ├── CalendarHeatmap.tsx # GitHub-style year calendar heatmap grid
│   │   ├── VisitedCountriesMap.tsx # Visited-countries choropleth (Overview)
│   │   ├── PlaybackBar.tsx    # Travel Map player: play/pause, date, scrubber, speed
│   │   └── FirstsAndStreaks.tsx # New countries/cities per year, travel/home streaks, firsts (Statistics)
│   └── pages/
│       ├── Overview.tsx       # Dashboard home with stat cards and summary charts
│       ├── Flights.tsx        # Flight log table + great-circle arc map
│       ├── Geography.tsx      # Countries/cities by days spent
│       ├── NightsAway.tsx     # Calendar heatmap + trip list
│       ├── TripDetail.tsx     # One trip: map, night-by-night stops, cities, flights
│       ├── TravelMap.tsx      # Full-screen map with route/mode/place layers and playback
│       ├── Statistics.tsx     # Detailed charts, patterns, and top places
│       └── Compare.tsx        # Two calendar years side by side: stat rows, overlaid monthly charts, mode split
├── package.json
├── tsconfig.json
├── tsconfig.pipeline.json     # Type-checks src/pipeline/ with no DOM/Node types
├── vite.config.ts
├── vitest.config.ts           # Test config: src/**/*.test.ts, node environment
├── eslint.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Privacy

All data processing happens locally on your machine. The in-browser import reads your file and processes it inside your browser (a Web Worker); the result is stored in your browser's IndexedDB, for this site only, until you use **Clear imported data** (or clear the site's data in your browser). It never looks places up online. The only external requests are for map tiles (Esri dark basemap) and, with the command-line `npm run preprocess` only, optional Nominatim reverse geocoding (coordinates only, rate-limited); the world map's country borders, the city database and the airport list ship with the app. Your timeline data is never uploaded anywhere. `Timeline.json`, `public/data/`, and `timeline-config.json` (your family homes' coordinates) are gitignored so your location history can't be committed accidentally.

Two things *are* meant to be committed, so mind them if your fork is public: `scripts/data/offline-city-db.json` grows with the places your online preprocess runs resolve (a city-level footprint of where your timeline has been — trim it back to the stock file if you'd rather not share that), and a build made after `npm run preprocess` contains your `public/data/` inside `dist/`, so only deploy an import-only build (or deploy privately).

## License

The code is released under the [MIT License](LICENSE). The committed data files have their own terms: `public/world-countries.geo.json` derives from [Natural Earth](https://www.naturalearthdata.com/) (public domain), `scripts/data/airports.json` from [OurAirports](https://ourairports.com/data/) (public domain), and the online-resolved entries of `scripts/data/offline-city-db.json` from © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors ([ODbL](https://opendatacommons.org/licenses/odbl/)).
