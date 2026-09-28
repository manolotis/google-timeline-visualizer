/**
 * Flights page — tabular and map view of the flights in the selected range.
 *
 * Shows a sortable flight log table, summary stats, and an interactive
 * Leaflet map with great-circle arcs for each flight route. Great-circle
 * paths are computed using the Haversine-based intermediate point formula
 * for visually accurate curved arcs on the map.
 */
import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import { useFlights, useStats } from '../hooks/useData';
import Loader from '../components/Loader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import { summarizeActivities } from '../aggregate';
import { useTimeRange, inRange } from '../timeRange';
import 'leaflet/dist/leaflet.css';

function greatCircleArc(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  numPoints = 50,
): [number, number][] {
  // Generate points along a great circle for curved flight paths
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1), λ1 = toRad(lng1);
  const φ2 = toRad(lat2), λ2 = toRad(lng2);
  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((φ2 - φ1) / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
    ),
  );
  if (d < 0.001) return [[lat1, lng1], [lat2, lng2]];

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    points.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return points;
}

type SortField = 'date' | 'distance' | 'duration';
type SortDir = 'asc' | 'desc';

export default function Flights() {
  const { data: flights, loading, error } = useFlights();
  const { data: stats, loading: sl } = useStats();
  const { range } = useTimeRange();
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
        : a.durationMin - b.durationMin;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return f;
  }, [inRangeFlights, sortField, sortDir]);

  // Same number as the Overview's "Flight Distance" (activity log, FLYING)
  const flightKm = useMemo(
    () => (stats ? summarizeActivities(stats, range).distanceByMode.FLYING ?? 0 : 0),
    [stats, range],
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

  const toggle = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      {/* Map ("isolate" keeps Leaflet's z-indexed panes below the sticky nav) */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden isolate" style={{ height: 400 }}>
        <MapContainer
          center={[30, 0]}
          zoom={2}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
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
              <Tooltip>{f.startCity ? `${f.startCity} · ${f.date}` : f.date}</Tooltip>
            </CircleMarker>
          ))}
          {sorted.map((f, i) => (
            <CircleMarker
              key={`e-${i}`}
              center={[f.endLat, f.endLng]}
              radius={3}
              pathOptions={{ color: '#fb923c', fillColor: '#fb923c', fillOpacity: 0.8 }}
            >
              <Tooltip>{f.endCity ? `${f.endCity} · ${f.date}` : f.date}</Tooltip>
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
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => toggle('distance')}>
                  Distance{sortIcon('distance')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:text-white" onClick={() => toggle('duration')}>
                  Duration{sortIcon('duration')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-gray-200">{f.date}</td>
                  <td className="px-4 py-2.5">
                    {f.startCity ? (
                      <>
                        <span className="text-gray-200">{f.startCity}, {f.startCountry}</span>
                        <span className="block text-[10px] text-gray-500 font-mono">{f.startLat.toFixed(2)}, {f.startLng.toFixed(2)}</span>
                      </>
                    ) : (
                      <span className="text-gray-400 font-mono text-xs">{f.startLat.toFixed(2)}, {f.startLng.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {f.endCity ? (
                      <>
                        <span className="text-gray-200">{f.endCity}, {f.endCountry}</span>
                        <span className="block text-[10px] text-gray-500 font-mono">{f.endLat.toFixed(2)}, {f.endLng.toFixed(2)}</span>
                      </>
                    ) : (
                      <span className="text-gray-400 font-mono text-xs">{f.endLat.toFixed(2)}, {f.endLng.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">{f.distanceKm.toLocaleString()} km</td>
                  <td className="px-4 py-2.5 text-gray-300">
                    {f.durationMin >= 60
                      ? `${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m`
                      : `${f.durationMin}m`}
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
