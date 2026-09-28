/**
 * Flights page — tabular and map view of the flights in the selected range.
 *
 * Shows a sortable flight log table (sort order kept in the URL), summary
 * stats, and an interactive Leaflet map with great-circle arcs for each
 * flight route (see flight.ts).
 */
import { useMemo } from 'react';
import { MapContainer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import DarkBasemap from '../components/DarkBasemap';
import { useFlights, useStats } from '../hooks/useData';
import { setParams, useRoute, type RouteParams } from '../route';
import Loader from '../components/Loader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import { summarizeActivities } from '../aggregate';
import { greatCircleArc, formatDuration } from '../flight';
import { useTimeRange, inRange } from '../timeRange';
import type { Flight } from '../types';
import 'leaflet/dist/leaflet.css';

type SortField = 'date' | 'distance' | 'duration' | 'co2';
type SortDir = 'asc' | 'desc';

/**
 * The table's sort order lives in the URL: `sort=distance|duration|co2` and
 * `dir=asc`, each omitted at its default (newest first).
 */
function sortFromParams(params: RouteParams): { field: SortField; dir: SortDir } {
  const { sort, dir } = params;
  return {
    field: sort === 'distance' || sort === 'duration' || sort === 'co2' ? sort : 'date',
    dir: dir === 'asc' ? 'asc' : 'desc',
  };
}

/** Average EU per-capita annual carbon footprint, for the CO2 stat card's subtitle. */
const EU_PER_CAPITA_ANNUAL_CO2_TONNES = 7;

/** Map marker tooltip text for one flight endpoint: IATA code (if matched), city, date. */
function endpointTooltip(airport: Flight['startAirport'], city: string | undefined, date: string): string {
  const place = [airport?.iata, city].filter(Boolean).join(' · ');
  return place ? `${place} · ${date}` : date;
}

export default function Flights() {
  const { data: flights, loading, error } = useFlights();
  const { data: stats, loading: sl } = useStats();
  const { range } = useTimeRange();
  const { params } = useRoute();
  const { field: sortField, dir: sortDir } = sortFromParams(params);

  const inRangeFlights = useMemo(
    () => flights?.filter((f) => inRange(f.date, range)) ?? [],
    [flights, range],
  );

  const sorted = useMemo(() => {
    const f = [...inRangeFlights];
    f.sort((a, b) => {
      const cmp =
        sortField === 'date' ? a.date.localeCompare(b.date)
        : sortField === 'distance' ? a.distanceKm - b.distanceKm
        : sortField === 'duration' ? a.durationMin - b.durationMin
        : (a.co2Kg ?? 0) - (b.co2Kg ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return f;
  }, [inRangeFlights, sortField, sortDir]);

  // Same number as the Overview's "Flight Distance" (activity log, FLYING)
  const flightKm = useMemo(
    () => (stats ? summarizeActivities(stats, range).distanceByMode.FLYING ?? 0 : 0),
    [stats, range],
  );

  const co2Tonnes = useMemo(
    () => inRangeFlights.reduce((sum, f) => sum + (f.co2Kg ?? 0), 0) / 1000,
    [inRangeFlights],
  );

  if (loading || sl) return <Loader />;
  if (!flights) return <EmptyState error={error} />;

  const header = <h1 className="text-3xl font-bold text-white">Flights</h1>;
  if (inRangeFlights.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {header}
        <NoDataInRange title="No flights in this range" />
      </div>
    );
  }

  // Same column flips the direction; a new column starts descending
  const toggle = (field: SortField) => {
    const dir: SortDir = field === sortField && sortDir === 'desc' ? 'asc' : 'desc';
    setParams(
      { sort: field === 'date' ? null : field, dir: dir === 'desc' ? null : dir },
      { replace: true },
    );
  };

  const sortIcon = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  // Most frequent route (by start/end grid cell ~ 0.5 degree)
  const routeCounts = new Map<string, number>();
  for (const f of inRangeFlights) {
    const key = `${Math.round(f.startLat * 2)}/${Math.round(f.startLng * 2)}-${Math.round(f.endLat * 2)}/${Math.round(f.endLng * 2)}`;
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  const topRouteCount = Math.max(...routeCounts.values());
  const avgDuration = Math.round(
    inRangeFlights.reduce((s, f) => s + f.durationMin, 0) / inRangeFlights.length,
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard icon="✈️" label="Total Flights" value={inRangeFlights.length} />
        <StatCard
          icon="📏"
          label="Total Distance"
          value={`${flightKm.toLocaleString()} km`}
        />
        <StatCard
          icon="🔁"
          label="Most Repeated Route"
          value={`${topRouteCount}×`}
        />
        <StatCard
          icon="⏱️"
          label="Avg Duration"
          value={`${avgDuration} min`}
        />
        <StatCard
          icon="☁️"
          label="Estimated CO₂"
          value={`${co2Tonnes.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`}
          sub={
            co2Tonnes >= EU_PER_CAPITA_ANNUAL_CO2_TONNES
              ? `${(co2Tonnes / EU_PER_CAPITA_ANNUAL_CO2_TONNES).toLocaleString(undefined, { maximumFractionDigits: 1 })}× avg. EU annual footprint (~${EU_PER_CAPITA_ANNUAL_CO2_TONNES} t/yr)`
              : `${Math.round((co2Tonnes / EU_PER_CAPITA_ANNUAL_CO2_TONNES) * 100)}% of avg. EU annual footprint (~${EU_PER_CAPITA_ANNUAL_CO2_TONNES} t/yr)`
          }
        />
      </div>

      {/* Map ("isolate" keeps Leaflet's z-indexed panes below the sticky nav) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden isolate" style={{ height: 400 }}>
        <MapContainer
          center={[30, 0]}
          zoom={2}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <DarkBasemap />
          {sorted.map((f, i) => (
            <Polyline
              key={i}
              positions={greatCircleArc(f.startLat, f.startLng, f.endLat, f.endLng)}
              pathOptions={{ color: '#f59e0b', weight: 1.5, opacity: 0.6 }}
            />
          ))}
          {sorted.map((f, i) => (
            <CircleMarker
              key={`s-${i}`}
              center={[f.startLat, f.startLng]}
              radius={3}
              pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.8 }}
            >
              <Tooltip>{endpointTooltip(f.startAirport, f.startCity, f.date)}</Tooltip>
            </CircleMarker>
          ))}
          {sorted.map((f, i) => (
            <CircleMarker
              key={`e-${i}`}
              center={[f.endLat, f.endLng]}
              radius={3}
              pathOptions={{ color: '#fb923c', fillColor: '#fb923c', fillOpacity: 0.8 }}
            >
              <Tooltip>{endpointTooltip(f.endAirport, f.endCity, f.date)}</Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => toggle('date')}>
                  Date{sortIcon('date')}
                </th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => toggle('distance')}>
                  Distance{sortIcon('distance')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => toggle('duration')}>
                  Duration{sortIcon('duration')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => toggle('co2')}>
                  CO₂{sortIcon('co2')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-gray-200 whitespace-nowrap">{f.date}</td>
                  <td className="px-4 py-2.5">
                    <RouteCell flight={f} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{f.distanceKm.toLocaleString()} km</td>
                  <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{formatDuration(f.durationMin)}</td>
                  <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">
                    {f.co2Kg != null ? `${Math.round(f.co2Kg).toLocaleString()} kg` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route cell: "AMS → SFO" (IATA, full name on hover) when both endpoints
// matched an airport; falls back to city names, then raw coordinates.
// ---------------------------------------------------------------------------

function RouteCell({ flight }: { flight: Flight }) {
  if (flight.startAirport && flight.endAirport) {
    return (
      <div>
        <span className="text-gray-200 font-medium" title={flight.startAirport.name}>
          {flight.startAirport.iata}
        </span>
        <span className="text-gray-500"> → </span>
        <span className="text-gray-200 font-medium" title={flight.endAirport.name}>
          {flight.endAirport.iata}
        </span>
        {(flight.startCity || flight.endCity) && (
          <span className="block text-[10px] text-gray-500">
            {flight.startCity ?? '?'} → {flight.endCity ?? '?'}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <EndpointLabel city={flight.startCity} country={flight.startCountry} lat={flight.startLat} lng={flight.startLng} />
      <span className="text-gray-500">→</span>
      <EndpointLabel city={flight.endCity} country={flight.endCountry} lat={flight.endLat} lng={flight.endLng} />
    </div>
  );
}

function EndpointLabel({
  city,
  country,
  lat,
  lng,
}: {
  city?: string;
  country?: string;
  lat: number;
  lng: number;
}) {
  if (city) {
    return (
      <span className="text-gray-200">
        {city}
        {country && <span className="text-gray-500">, {country}</span>}
      </span>
    );
  }
  return (
    <span className="text-gray-400 font-mono text-xs">
      {lat.toFixed(2)}, {lng.toFixed(2)}
    </span>
  );
}
