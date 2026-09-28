/**
 * Trip detail page — `#/trip?start=2024-03-14`, one trip in depth.
 *
 * Opened from the Nights Away trip list and the Overview trip highlights.
 * Shows the trip's own map (ground routes by mode, flight arcs, where each
 * night was spent, other places visited), a night-by-night itinerary, the
 * cities and countries visited, and the flights taken. Everything is
 * derived from the trip's dates (see trip.ts); the global time range does
 * not apply here, the trip is always shown whole.
 */
import { useEffect, useMemo } from 'react';
import { MapContainer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import DarkBasemap from '../components/DarkBasemap';
import type { FitBoundsOptions, LatLngTuple } from 'leaflet';
import {
  useTrips,
  useNightsAway,
  useFlights,
  useRoutes,
  useVisits,
  useStats,
  useGeography,
} from '../hooks/useData';
import { navigate, routeHref, setParams, useRoute } from '../route';
import { selectionToParams, useTimeRange } from '../timeRange';
import { isStaleGeography } from '../aggregate';
import { findTrip, summarizeTrip, type TripNight, type TripSummary } from '../trip';
import { formatDuration } from '../flight';
import {
  APP_TITLE,
  AWAY_NIGHT_COLORS,
  FALLBACK_MODE_COLOR,
  FAMILY_HOME_COLOR,
  HOME_NIGHT_COLOR,
  MODE_COLORS,
  MODE_LABELS,
  nightColor,
} from '../constants';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import type { Flight } from '../types';
import RegenerateHint from '../components/RegenerateHint';
import 'leaflet/dist/leaflet.css';

const STAY_COLOR = '#f97316';
const PLACE_COLOR = '#10b981';
const HOME_COLOR = '#22c55e';
const FIT_OPTIONS: FitBoundsOptions = { padding: [30, 30], maxZoom: 13 };
const WORLD_CENTER: LatLngTuple = [30, 0];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

const cityLabel = (city: string | null | undefined, country: string | null | undefined) =>
  city ? (country ? `${city}, ${country}` : city) : 'Unresolved place';

export default function TripDetail() {
  const { page, params } = useRoute();
  // parseHash only routes here with a valid date
  const start = params.start ?? '';
  const { selection, range, label } = useTimeRange();

  const { data: trips, loading: tl, error } = useTrips();
  const { data: nights, loading: nl } = useNightsAway();
  const { data: flights, loading: fl } = useFlights();
  const { data: routes, loading: rl } = useRoutes();
  const { data: visits, loading: vl } = useVisits();
  const { data: stats, loading: sl } = useStats();
  const { data: geo, loading: gl } = useGeography();

  const trip = useMemo(() => (trips ? findTrip(trips, start) : null), [trips, start]);

  const summary = useMemo(() => {
    if (!trip || !nights || !flights || !routes || !visits || !stats) return null;
    return summarizeTrip(trip, {
      nights,
      flights,
      routes,
      visits,
      stats,
      geo: geo && !isStaleGeography(geo) ? geo : null,
    });
  }, [trip, nights, flights, routes, visits, stats, geo]);

  // A date inside a trip (e.g. a link from before trips regrouped) shows
  // that trip under its own start date; with no trip there, fall back to
  // the trip list for that year. Both replace the URL, so back skips it.
  // Only while the URL is a trip's: when the browser itself changes the
  // hash (address bar), this page can render once more with the next
  // page's route before App unmounts it.
  useEffect(() => {
    if (!trips || page !== 'trip') return;
    if (!trip) {
      navigate(
        { page: 'nights', params: { ...selectionToParams(selection), year: start.slice(0, 4) } },
        { replace: true },
      );
    } else if (trip.startDate !== start) {
      setParams({ start: trip.startDate }, { replace: true });
    }
  }, [trips, trip, page, start, selection]);

  // Tab title (the nav names only its own pages)
  const destination = summary?.geography?.cities[0]?.city;
  const title = trip
    ? `${destination ? `Trip to ${destination}` : 'Trip'} · ${trip.startDate}`
    : 'Trip';
  useEffect(() => {
    if (page === 'trip') document.title = `${title} · ${APP_TITLE}`;
  }, [page, title]);

  if (tl || nl || fl || rl || vl || sl || gl) return <Loader />;
  if (!trips || !nights || !flights || !routes || !visits || !stats) {
    return <EmptyState error={error} />;
  }
  if (!trip || !summary) return <Loader />; // redirecting to the trip list

  const rangeParams = selectionToParams(selection);
  const year = trip.startDate.slice(0, 4);
  const backHref = routeHref({ page: 'nights', params: { ...rangeParams, year } });
  const allTime = range.start === null && range.end === null;

  const { geography, activity } = summary;
  const returnDay = summary.windows.days.end;
  const farthest = summary.nights.reduce<TripNight | null>(
    (best, n) => (!n.isHome && (n.distKm ?? 0) > (best?.distKm ?? -1) ? n : best),
    null,
  );
  const otherCities = geography ? geography.cities.length - 1 : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <a
          href={backHref}
          className="inline-block text-sm text-gray-400 hover:text-orange-400 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
        >
          ← Trips in {year}
        </a>
        <h1 className="text-3xl font-bold text-white">
          {destination ? `Trip to ${destination}` : 'Trip'}
          {otherCities > 0 && (
            <span className="text-gray-500 font-normal text-xl">
              {' '}
              + {plural(otherCities, 'more city', 'more cities')}
            </span>
          )}
        </h1>
        <p className="text-gray-400">
          {trip.startDate === trip.endDate ? trip.startDate : `${trip.startDate} → ${trip.endDate}`}
          {' · '}
          {plural(trip.nights, 'night')} away ·{' '}
          {summary.returnFamily ? `then 🏡 ${summary.returnFamily} from ${returnDay}` : `back home ${returnDay}`}
        </p>
        {!allTime && (
          <p className="text-xs text-gray-500">
            The {label} time range doesn't apply here: the whole trip is shown.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🌙" label="Nights Away" value={trip.nights} sub={plural(summary.legs.length, 'stop')} />
        <StatCard
          icon="🌍"
          label="Farthest From Home"
          value={`${trip.maxDistKm.toLocaleString()} km`}
          sub={farthest?.city ? `in ${farthest.city}` : undefined}
        />
        <StatCard
          icon="🏙️"
          label="Cities"
          value={geography ? geography.cities.length : '—'}
          sub={[
            geography ? plural(geography.countries.length, 'country', 'countries') : null,
            plural(summary.placeCount, 'place'),
          ].filter(Boolean).join(' · ')}
        />
        <StatCard
          icon="🗺️"
          label="Distance Traveled"
          value={`${activity.totalDistanceKm.toLocaleString()} km`}
          sub={summary.flights.length ? plural(summary.flights.length, 'flight') : 'No flights'}
        />
      </div>

      <TripMap tripKey={trip.startDate} summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Itinerary summary={summary} />
        <Places summary={summary} />
      </div>

      {summary.flights.length > 0 && <FlightList flights={summary.flights} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

function TripMap({ tripKey, summary }: { tripKey: string; summary: TripSummary }) {
  const { routes, flights, flightArcs, stays, places, home, homeFamily, bounds, activity } = summary;
  // The trip may have left from a family home rather than home itself
  const homeColor = homeFamily ? FAMILY_HOME_COLOR : HOME_COLOR;
  const homeName = homeFamily ? `${homeFamily} (family home)` : 'Home';

  // Modes by distance for the legend (unknown movement isn't drawn)
  const modes = Object.entries(activity.distanceByMode)
    .filter(([mode]) => mode !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1]);

  return (
    /* "isolate" keeps Leaflet's z-indexed panes below the sticky nav */
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden isolate">
      <div style={{ height: 460 }}>
        <MapContainer
          // Remount per trip: bounds only apply when the map is created
          key={tripKey}
          bounds={bounds ?? undefined}
          boundsOptions={FIT_OPTIONS}
          center={bounds ? undefined : WORLD_CENTER}
          zoom={bounds ? undefined : 2}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <DarkBasemap />

          {routes.map((r, i) => (
            <Polyline
              key={i}
              positions={r.points}
              pathOptions={{
                color: MODE_COLORS[r.mode] || FALLBACK_MODE_COLOR,
                weight: 2.5,
                opacity: 0.75,
              }}
            >
              <Tooltip sticky>
                {MODE_LABELS[r.mode] || r.mode} · {r.startTime.slice(0, 10)}
              </Tooltip>
            </Polyline>
          ))}

          {flightArcs.map((arc, i) => (
            <Polyline
              key={`f-${i}`}
              positions={arc}
              pathOptions={{ color: MODE_COLORS.FLYING, weight: 2.5, opacity: 0.9 }}
            >
              <Tooltip sticky>
                ✈️ {flightEnd(flights[i], 'start')} → {flightEnd(flights[i], 'end')} ·{' '}
                {flights[i].date} · {flights[i].distanceKm.toLocaleString()} km
              </Tooltip>
            </Polyline>
          ))}

          {places.map((p) => (
            <CircleMarker
              key={p.placeId}
              center={[p.lat, p.lng]}
              radius={Math.min(3 + Math.log2(p.totalHours + 1), 8)}
              pathOptions={{ color: PLACE_COLOR, fillColor: PLACE_COLOR, fillOpacity: 0.5, weight: 1 }}
            >
              <Tooltip>
                <div className="text-xs">
                  <div>
                    {p.city ? cityLabel(p.city, p.country) : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}
                  </div>
                  <div>
                    {plural(p.visitCount, 'visit')} · {p.totalHours}h
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}

          {stays.map((s) => (
            <CircleMarker
              key={`s-${s.placeId}`}
              center={[s.lat, s.lng]}
              radius={Math.min(5 + Math.log2(s.nights), 10)}
              pathOptions={{ color: '#fff', fillColor: STAY_COLOR, fillOpacity: 0.9, weight: 1.5 }}
            >
              <Tooltip>
                <div className="text-xs">
                  <div>🌙 {s.city ? cityLabel(s.city, s.country) : `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}</div>
                  <div>Slept here {plural(s.nights, 'night')}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}

          {home && (
            <CircleMarker
              center={home}
              radius={6}
              pathOptions={{ color: homeColor, fillColor: homeColor, fillOpacity: 0.8, weight: 2 }}
            >
              <Tooltip>{homeFamily ? '🏡' : '🏠'} {homeName}</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-gray-800 text-xs text-gray-400">
        {modes.map(([mode, km]) => (
          <span key={mode} className="flex items-center gap-1.5">
            <span
              className="w-3 h-1 rounded-full"
              style={{ backgroundColor: MODE_COLORS[mode] || FALLBACK_MODE_COLOR }}
            />
            {MODE_LABELS[mode] || mode}
            <span className="text-gray-500">{km.toLocaleString()} km</span>
          </span>
        ))}
        {modes.length > 0 && <span className="h-4 w-px bg-gray-700" />}
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border border-white" style={{ backgroundColor: STAY_COLOR }} />
          Slept here
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PLACE_COLOR }} />
          Visited
        </span>
        {home && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: homeColor }} />
            {homeName}
          </span>
        )}
      </div>
    </div>
  );
}

function flightEnd(f: Flight, end: 'start' | 'end'): string {
  const city = end === 'start' ? f.startCity : f.endCity;
  if (city) return city;
  const lat = end === 'start' ? f.startLat : f.endLat;
  const lng = end === 'start' ? f.startLng : f.endLng;
  return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Itinerary: a square per night, then the nights grouped into stops
// ---------------------------------------------------------------------------

function Itinerary({ summary }: { summary: TripSummary }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Night by Night</h2>

      <div className="flex flex-wrap gap-0.5" role="list" aria-label="Nights of the trip">
        {summary.nights.map((n) => (
          <div
            key={n.date}
            role="listitem"
            className="cal-cell"
            title={`${n.date}: ${n.isHome ? 'Home' : `${cityLabel(n.city, n.country)} (${n.distKm?.toLocaleString() ?? '?'} km from home)`}`}
            style={{ backgroundColor: nightColor(n) }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
        <span>Near</span>
        {AWAY_NIGHT_COLORS.map((color) => (
          <div key={color} className="cal-cell" style={{ backgroundColor: color }} />
        ))}
        <span>Far from home</span>
        {summary.nights.some((n) => n.isHome) && (
          <>
            <div className="cal-cell ml-3" style={{ backgroundColor: HOME_NIGHT_COLOR }} />
            <span>Home</span>
          </>
        )}
      </div>

      <ol className="mt-4 space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
        {summary.legs.map((leg) => (
          <li
            key={leg.start}
            className="flex items-center justify-between gap-3 bg-gray-800/50 rounded-lg px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm text-gray-200 truncate">
                {leg.isHome ? '🏠 Home' : cityLabel(leg.city, leg.country)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {leg.start === leg.end ? leg.start : `${leg.start} → ${leg.end}`}
                {leg.maxDistKm != null && !leg.isHome && ` · ${Math.round(leg.maxDistKm).toLocaleString()} km from home`}
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-sm font-semibold text-orange-400">{leg.nights}</span>{' '}
              <span className="text-xs text-gray-500">{leg.nights === 1 ? 'night' : 'nights'}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cities & countries
// ---------------------------------------------------------------------------

function Places({ summary }: { summary: TripSummary }) {
  const { geography } = summary;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Cities &amp; Countries</h2>
      {!geography ? (
        <p className="text-sm text-gray-500">
          City data is unavailable. <RegenerateHint />.
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Countries</h3>
            {geography.countries.length === 0 ? (
              <p className="text-sm text-gray-500">No nights resolved to a country.</p>
            ) : (
              <ul className="space-y-1">
                {geography.countries.map((c) => (
                  <li key={c.country} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-gray-200">{c.country}</span>
                    <span className="text-gray-500 text-xs shrink-0">
                      <span className="text-orange-400 font-semibold text-sm">{c.nights}</span>{' '}
                      {c.nights === 1 ? 'night' : 'nights'} · {plural(c.daysPresent, 'day')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {geography.passedThrough.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Passed through without staying the night:{' '}
                {geography.passedThrough
                  .map((c) => `${c.country} (${plural(c.daysPresent, 'day')})`)
                  .join(', ')}
              </p>
            )}
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Cities</h3>
            {geography.cities.length === 0 ? (
              <p className="text-sm text-gray-500">No nights resolved to a city.</p>
            ) : (
              <ul className="space-y-1 max-h-[18rem] overflow-y-auto pr-1">
                {geography.cities.map((c) => (
                  <li key={`${c.city}|${c.country}`} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="text-gray-200">{c.city}</span>
                      <span className="text-gray-500">, {c.country}</span>
                    </span>
                    <span className="text-gray-500 text-xs shrink-0">
                      <span className="text-orange-400 font-semibold text-sm">{c.nights}</span>{' '}
                      {c.nights === 1 ? 'night' : 'nights'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {geography.unresolvedNights > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                {plural(geography.unresolvedNights, 'night')} couldn't be matched to a city.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

function FlightList({ flights }: { flights: Flight[] }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <h2 className="text-lg font-semibold text-white px-5 pt-5 pb-3">
        Flights ({flights.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">To</th>
              <th className="px-4 py-2">Distance</th>
              <th className="px-4 py-2">Duration</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr key={f.startTime} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-2 text-gray-200 whitespace-nowrap">
                  {f.date}{' '}
                  <span className="text-gray-500" title="Local departure time">{f.startTime.slice(11, 16)}</span>
                </td>
                <FlightEndCell city={f.startCity} country={f.startCountry} lat={f.startLat} lng={f.startLng} airport={f.startAirport} />
                <FlightEndCell city={f.endCity} country={f.endCountry} lat={f.endLat} lng={f.endLng} airport={f.endAirport} />
                <td className="px-4 py-2 text-gray-300 whitespace-nowrap">{f.distanceKm.toLocaleString()} km</td>
                <td className="px-4 py-2 text-gray-300 whitespace-nowrap">{formatDuration(f.durationMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlightEndCell({
  city,
  country,
  lat,
  lng,
  airport,
}: {
  city?: string;
  country?: string;
  lat: number;
  lng: number;
  airport?: Flight['startAirport'];
}) {
  return (
    <td className="px-4 py-2">
      {airport ? (
        <>
          <span className="text-gray-200 font-medium" title={airport.name}>{airport.iata}</span>
          {city && <span className="text-gray-500"> · {city}{country ? `, ${country}` : ''}</span>}
        </>
      ) : city ? (
        <>
          <span className="text-gray-200">{city}</span>
          {country && <span className="text-gray-500">, {country}</span>}
        </>
      ) : (
        <span className="text-gray-400 font-mono text-xs">
          {lat.toFixed(2)}, {lng.toFixed(2)}
        </span>
      )}
    </td>
  );
}
