/**
 * Travel Map page — full-screen interactive route visualization.
 *
 * Renders all movement segments on a Leaflet map with CARTO dark tiles.
 * Routes are color-coded by transport mode (15 types). Controls include
 * year range filtering, per-mode toggles, and a place marker layer.
 * Route polylines are downsampled to max 50 points each during
 * preprocessing to keep the total payload manageable (~3MB).
 */
import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { useRoutes, useVisits, useHome } from '../hooks/useData';
import Loader from '../components/Loader';
import 'leaflet/dist/leaflet.css';

const MODE_COLORS: Record<string, string> = {
  FLYING: '#f59e0b',
  WALKING: '#22c55e',
  CYCLING: '#3b82f6',
  IN_VEHICLE: '#a855f7',
  IN_PASSENGER_VEHICLE: '#ec4899',
  IN_TRAIN: '#06b6d4',
  IN_BUS: '#14b8a6',
  IN_SUBWAY: '#8b5cf6',
  IN_TRAM: '#64748b',
  IN_FERRY: '#0ea5e9',
  MOTORCYCLING: '#ef4444',
  RUNNING: '#10b981',
  SAILING: '#0284c7',
  SKIING: '#e2e8f0',
  UNKNOWN_ACTIVITY_TYPE: '#374151',
};

const MODE_LABELS: Record<string, string> = {
  FLYING: 'Flying',
  WALKING: 'Walking',
  CYCLING: 'Cycling',
  IN_VEHICLE: 'Driving',
  IN_PASSENGER_VEHICLE: 'Taxi/Ride',
  IN_TRAIN: 'Train',
  IN_BUS: 'Bus',
  IN_SUBWAY: 'Subway',
  IN_TRAM: 'Tram',
  IN_FERRY: 'Ferry',
  MOTORCYCLING: 'Motorcycle',
  RUNNING: 'Running',
  SAILING: 'Sailing',
  SKIING: 'Skiing',
  UNKNOWN_ACTIVITY_TYPE: 'Unknown',
};

// Fit map bounds to data
function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useMemo(() => {
    if (coords.length > 0) {
      const lats = coords.map((c) => c[0]);
      const lngs = coords.map((c) => c[1]);
      map.fitBounds([
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ], { padding: [20, 20] });
    }
  }, [coords, map]);
  return null;
}

export default function TravelMap() {
  const { data: routes, loading: rl } = useRoutes();
  const { data: visits, loading: vl } = useVisits();
  const { data: home } = useHome();

  const allModes = useMemo(() => {
    if (!routes) return [];
    const s = new Set(routes.map((r) => r.mode));
    return [...s].sort();
  }, [routes]);

  const [activeModes, setActiveModes] = useState<Set<string>>(new Set());
  const [yearRange, setYearRange] = useState<[number, number]>([2013, 2026]);
  const [showVisits, setShowVisits] = useState(true);

  // Initialize active modes once routes load
  useMemo(() => {
    if (allModes.length > 0 && activeModes.size === 0) {
      // Default: show major transport modes, not walking/unknown
      setActiveModes(new Set(allModes.filter(
        (m) => m !== 'UNKNOWN_ACTIVITY_TYPE' && m !== 'WALKING',
      )));
    }
  }, [allModes]);

  const filteredRoutes = useMemo(() => {
    if (!routes) return [];
    return routes.filter((r) => {
      if (!activeModes.has(r.mode)) return false;
      const y = new Date(r.startTime).getFullYear();
      return y >= yearRange[0] && y <= yearRange[1];
    });
  }, [routes, activeModes, yearRange]);

  const filteredVisits = useMemo(() => {
    if (!visits || !showVisits) return [];
    return visits
      .filter((v) => {
        const y = new Date(v.firstVisit).getFullYear();
        return y >= yearRange[0] && y <= yearRange[1];
      })
      .filter((v) => v.semanticType !== 'INFERRED_HOME' && v.semanticType !== 'HOME')
      .slice(0, 500); // cap for performance
  }, [visits, showVisits, yearRange]);

  // Gather some bounds points from filtered data
  const boundsCoords = useMemo((): [number, number][] => {
    if (!home) return [];
    const pts: [number, number][] = [[home.lat, home.lng]];
    for (const r of filteredRoutes.slice(0, 200)) {
      if (r.points.length > 0) {
        pts.push(r.points[0]);
        pts.push(r.points[r.points.length - 1]);
      }
    }
    return pts;
  }, [filteredRoutes, home]);

  if (rl || vl) return <Loader />;
  if (!routes) return <div className="p-6 text-gray-400">No route data</div>;

  const toggleMode = (mode: string) => {
    setActiveModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  };

  const years = [];
  for (let y = 2013; y <= 2026; y++) years.push(y);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        {/* Year range */}
        <div className="flex items-center gap-2 text-sm">
          <select
            value={yearRange[0]}
            onChange={(e) => setYearRange([parseInt(e.target.value), yearRange[1]])}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span className="text-gray-500">–</span>
          <select
            value={yearRange[1]}
            onChange={(e) => setYearRange([yearRange[0], parseInt(e.target.value)])}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="h-5 w-px bg-gray-700" />

        {/* Mode toggles */}
        <div className="flex flex-wrap gap-1.5">
          {allModes.map((mode) => (
            <button
              key={mode}
              onClick={() => toggleMode(mode)}
              className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                activeModes.has(mode)
                  ? 'border-opacity-50 text-white'
                  : 'border-gray-700 text-gray-600'
              }`}
              style={{
                borderColor: activeModes.has(mode) ? MODE_COLORS[mode] : undefined,
                backgroundColor: activeModes.has(mode) ? MODE_COLORS[mode] + '20' : undefined,
              }}
            >
              {MODE_LABELS[mode] || mode}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-gray-700" />

        <button
          onClick={() => setShowVisits((v) => !v)}
          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
            showVisits
              ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
              : 'border-gray-700 text-gray-600'
          }`}
        >
          📍 Places
        </button>

        <span className="text-xs text-gray-500 ml-auto">
          {filteredRoutes.length} segments
        </span>
      </div>

      {/* Map */}
      <div className="flex-1">
        <MapContainer
          center={home ? [home.lat, home.lng] : [30, 0]}
          zoom={5}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {boundsCoords.length > 2 && <FitBounds coords={boundsCoords} />}

          {/* Home marker */}
          {home && (
            <CircleMarker
              center={[home.lat, home.lng]}
              radius={6}
              pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8, weight: 2 }}
            >
              <Tooltip permanent className="!bg-gray-900 !text-green-400 !border-green-800 !text-xs">
                🏠 Home
              </Tooltip>
            </CircleMarker>
          )}

          {/* Route polylines */}
          {filteredRoutes.map((r, i) => (
            <Polyline
              key={i}
              positions={r.points}
              pathOptions={{
                color: MODE_COLORS[r.mode] || '#6b7280',
                weight: r.mode === 'FLYING' ? 1.5 : 1,
                opacity: 0.4,
              }}
            />
          ))}

          {/* Visit markers */}
          {filteredVisits.map((v, i) => (
            <CircleMarker
              key={i}
              center={[v.lat, v.lng]}
              radius={Math.min(2 + Math.log2(v.visitCount + 1) * 1.5, 10)}
              pathOptions={{
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 0.5,
                weight: 0.5,
              }}
            >
              <Tooltip>
                <div className="text-xs">
                  <div>{v.placeId.slice(0, 20)}</div>
                  <div>{v.visitCount} visits · {v.totalHours}h</div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
