/**
 * Travel Map page — full-screen interactive route visualization.
 *
 * Renders the movement segments in the globally selected time range on a
 * Leaflet map with CARTO dark tiles. Routes are color-coded by transport
 * mode (15 types). Controls include per-mode toggles and a layer of the
 * places visited in the range; every home that applies to the range gets a
 * marker labelled with the years you lived there. Route polylines are
 * downsampled to max 50 points each during preprocessing to keep the total
 * payload manageable (~3MB).
 */
import { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { useRoutes, useVisits, useHomePeriods } from '../hooks/useData';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import { MODE_COLORS, MODE_LABELS, FALLBACK_MODE_COLOR } from '../constants';
import {
  summarizeVisits,
  isHomePlace,
  isStaleHome,
  homePeriodsInRange,
  homePeriodYears,
} from '../aggregate';
import { useTimeRange, inRange } from '../timeRange';
import 'leaflet/dist/leaflet.css';

// Fit map bounds to data
function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
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
  const { data: routes, loading: rl, error } = useRoutes();
  const { data: visits, loading: vl } = useVisits();
  const { data: homeData } = useHomePeriods();
  const { range } = useTimeRange();

  // One marker per home place that applies to the range; a place lived in
  // more than once (A → B → A) lists every stretch on the same marker
  const staleHome = !!homeData && isStaleHome(homeData);
  const homes = useMemo(() => {
    if (!homeData || staleHome) return [];
    const byPlace = new Map<string, { lat: number; lng: number; years: string[] }>();
    for (const p of homePeriodsInRange(homeData, range)) {
      const key = `${p.lat},${p.lng}`;
      const place = byPlace.get(key);
      if (place) place.years.push(homePeriodYears(p));
      else byPlace.set(key, { lat: p.lat, lng: p.lng, years: [homePeriodYears(p)] });
    }
    return [...byPlace.values()];
  }, [homeData, staleHome, range]);
  const latestHome = homes.at(-1);

  const allModes = useMemo(() => {
    if (!routes) return [];
    const s = new Set(routes.map((r) => r.mode));
    return [...s].sort();
  }, [routes]);

  // Per-mode user toggles layered over the default (major modes on,
  // walking/unknown off) so no state initialization is needed on load.
  const [modeOverrides, setModeOverrides] = useState<Map<string, boolean>>(new Map());
  const [showVisits, setShowVisits] = useState(true);

  const activeModes = useMemo(() => {
    const active = new Set(allModes.filter(
      (m) => m !== 'UNKNOWN_ACTIVITY_TYPE' && m !== 'WALKING',
    ));
    for (const [mode, on] of modeOverrides) {
      if (on) active.add(mode);
      else active.delete(mode);
    }
    return active;
  }, [allModes, modeOverrides]);

  const rangeRoutes = useMemo(
    () => routes?.filter((r) => inRange(r.startTime.slice(0, 10), range)) ?? [],
    [routes, range],
  );

  const filteredRoutes = useMemo(
    () => rangeRoutes.filter((r) => activeModes.has(r.mode)),
    [rangeRoutes, activeModes],
  );

  // Places visited in the range, most visited (in the range) first;
  // visit counts and hours on the markers are for the range too
  const rangePlaces = useMemo(
    () => (visits ? summarizeVisits(visits, range).places.filter((p) => !isHomePlace(p.semanticType)) : []),
    [visits, range],
  );

  const filteredVisits = useMemo(
    () => (showVisits ? rangePlaces.slice(0, 500) : []), // cap for performance
    [rangePlaces, showVisits],
  );

  // Gather some bounds points from filtered data; only fitted when there are routes
  const boundsCoords = useMemo((): [number, number][] => {
    const pts: [number, number][] = [];
    for (const r of filteredRoutes.slice(0, 200)) {
      if (r.points.length > 0) {
        pts.push(r.points[0]);
        pts.push(r.points[r.points.length - 1]);
      }
    }
    if (pts.length === 0) return pts;
    return [...homes.map((h): [number, number] => [h.lat, h.lng]), ...pts];
  }, [filteredRoutes, homes]);

  if (rl || vl) return <Loader />;
  if (!routes) return <EmptyState error={error} />;

  const toggleMode = (mode: string) => {
    setModeOverrides((prev) => new Map(prev).set(mode, !activeModes.has(mode)));
  };

  const hasDataInRange = rangeRoutes.length > 0 || rangePlaces.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Controls bar (the time range comes from the global control in the top bar) */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
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

        {staleHome && (
          <span className="text-xs text-gray-400">
            Re-run <code className="bg-gray-800 text-orange-400 px-1.5 py-0.5 rounded">npm run preprocess</code>{' '}
            to show your homes
          </span>
        )}

        <span className="text-xs text-gray-500 ml-auto">
          {filteredRoutes.length} segments
        </span>
      </div>

      {!hasDataInRange ? (
        <div className="flex-1 p-6">
          <div className="max-w-2xl mx-auto mt-6">
            <NoDataInRange title="No routes or places in this range" />
          </div>
        </div>
      ) : (
        /* Map ("isolate" keeps Leaflet's z-indexed panes below the sticky nav) */
        <div className="flex-1 isolate">
          <MapContainer
            center={latestHome ? [latestHome.lat, latestHome.lng] : [30, 0]}
            zoom={5}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            {boundsCoords.length > 0 && <FitBounds coords={boundsCoords} />}

            {/* Home markers, one per home place in the range */}
            {homes.map((h) => (
              <CircleMarker
                key={`${h.lat},${h.lng}`}
                center={[h.lat, h.lng]}
                radius={6}
                pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8, weight: 2 }}
              >
                <Tooltip permanent className="!bg-gray-900 !text-green-400 !border-green-800 !text-xs">
                  🏠 Home {h.years.join(', ')}
                </Tooltip>
              </CircleMarker>
            ))}

            {/* Route polylines */}
            {filteredRoutes.map((r, i) => (
              <Polyline
                key={i}
                positions={r.points}
                pathOptions={{
                  color: MODE_COLORS[r.mode] || FALLBACK_MODE_COLOR,
                  weight: r.mode === 'FLYING' ? 1.5 : 1,
                  opacity: 0.4,
                }}
              />
            ))}

            {/* Visit markers */}
            {filteredVisits.map((v) => (
              <CircleMarker
                key={v.placeId}
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
                    <div>
                      {v.city
                        ? `${v.city}${v.country ? `, ${v.country}` : ''}`
                        : `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`}
                    </div>
                    <div>{v.visitCount} visits · {v.totalHours}h</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      )}
    </div>
  );
}
