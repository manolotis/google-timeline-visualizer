/**
 * Travel Map page — full-screen interactive route visualization.
 *
 * Renders the movement segments in the globally selected time range on a
 * Leaflet map with CARTO dark tiles. Routes are color-coded by transport
 * mode (15 types). Controls include per-mode toggles and a layer of the
 * places visited in the range, both kept in the URL; every home that applies
 * to the range gets a marker labelled with the years you lived there, and
 * every family home stayed at in the range a ring labelled with its name.
 * Route polylines are downsampled to max 50 points each during preprocessing
 * to keep the total payload manageable (~3MB).
 *
 * Routes are drawn by one canvas layer (routeCanvas.ts) rather than a
 * Leaflet path per segment, which is what makes playback possible: the
 * Playback button (`playback=on` in the URL) opens a bar that plays the
 * range back in time order, drawing the history as it goes, with the newest
 * segments emphasized and places and homes appearing as they are first
 * visited. The playback position itself lives in a PlaybackClock (not React
 * state, not the URL), so the page doesn't re-render every frame.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { MapContainer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import DarkBasemap from '../components/DarkBasemap';
import type { LatLngTuple, PathOptions } from 'leaflet';
import { useRoutes, useVisits, useHomePeriods, useFamilyHomes, useNightsAway } from '../hooks/useData';
import { setParams, useRoute } from '../route';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import PlaybackBar from '../components/PlaybackBar';
import { MODE_COLORS, MODE_LABELS, FAMILY_HOME_COLOR } from '../constants';
import {
  summarizeVisits,
  isHomePlace,
  isStaleHome,
  homePeriodsInRange,
  homePeriodYears,
  familyHomesInRange,
  type PlaceSummary,
} from '../aggregate';
import { useTimeRange, inRange, type DateRange } from '../timeRange';
import {
  DAY_MS,
  PlaybackClock,
  TRAIL_SECONDS,
  autoSpeed,
  countUpTo,
  dateStartTime,
  playbackDate,
  usePlaybackSelect,
  type PlaybackSpeed,
} from '../playback';
import {
  buildRouteIndex,
  playbackBounds,
  selectRoutes,
  type RouteIndex,
  type RouteSelection,
} from '../routeIndex';
import { RouteCanvasLayer } from '../routeCanvas';
import type { HomePeriod, Visit } from '../types';
import RegenerateHint from '../components/RegenerateHint';
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

/** Modes drawn unless toggled: everything but walking and unknown. */
function isDefaultMode(mode: string): boolean {
  return mode !== 'UNKNOWN_ACTIVITY_TYPE' && mode !== 'WALKING';
}

/**
 * Mode toggles are stored in the URL as the differences from the defaults,
 * in lower case: `show=walking&hide=flying,in_bus`. Returns mode → on.
 */
function parseModeOverrides(show?: string, hide?: string): Map<string, boolean> {
  const overrides = new Map<string, boolean>();
  for (const [list, on] of [[show, true], [hide, false]] as const) {
    for (const mode of list?.split(',') ?? []) {
      if (mode) overrides.set(mode.toUpperCase(), on);
    }
  }
  return overrides;
}

function modeOverridesToParams(overrides: Map<string, boolean>): { show: string | null; hide: string | null } {
  const list = (on: boolean) =>
    [...overrides].filter(([, v]) => v === on).map(([mode]) => mode.toLowerCase()).sort().join(',') || null;
  return { show: list(true), hide: list(false) };
}

/**
 * The selected routes, drawn up to the playback time (everything when
 * `clock` is null). The canvas layer redraws straight from the clock's
 * subscription, outside React.
 */
function RouteLayer({
  index,
  selection,
  clock,
  trailSpan,
}: {
  index: RouteIndex;
  selection: RouteSelection;
  clock: PlaybackClock | null;
  trailSpan: number;
}) {
  const map = useMap();
  const [layer] = useState(() => new RouteCanvasLayer());

  useEffect(() => {
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [layer, map]);

  useEffect(() => layer.setSelection(index, selection), [layer, index, selection]);
  useEffect(() => layer.setTrailSpan(trailSpan), [layer, trailSpan]);

  useEffect(() => {
    if (!clock) {
      layer.setTime(Infinity);
      return;
    }
    const sync = () => layer.setTime(clock.getSnapshot().time);
    sync();
    return clock.subscribe(sync);
  }, [layer, clock]);

  return null;
}

const HOME_PATH: PathOptions = { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8, weight: 2 };

/**
 * One marker per home place, a place lived in more than once (A → B → A)
 * listing every stretch. During playback a home appears once its period
 * applies (the first one from the start).
 */
function HomeMarkers({
  allPeriods,
  periods,
  range,
  clock,
}: {
  /** home.json */
  allPeriods: HomePeriod[];
  /** The ones that apply to the range */
  periods: HomePeriod[];
  range: DateRange;
  clock: PlaybackClock | null;
}) {
  // The periods up to the playback date are always a prefix of the range's
  const shown = usePlaybackSelect(
    clock,
    (time) => homePeriodsInRange(allPeriods, { start: range.start, end: playbackDate(time) }).length,
    periods.length,
  );
  const homes = useMemo(() => {
    const byPlace = new Map<string, { center: LatLngTuple; years: string[] }>();
    for (const p of periods.slice(0, shown)) {
      const key = `${p.lat},${p.lng}`;
      const place = byPlace.get(key);
      if (place) place.years.push(homePeriodYears(p));
      else byPlace.set(key, { center: [p.lat, p.lng], years: [homePeriodYears(p)] });
    }
    return [...byPlace.values()];
  }, [periods, shown]);

  return (
    <>
      {homes.map((h) => (
        <CircleMarker key={h.center.join()} center={h.center} radius={6} pathOptions={HOME_PATH}>
          <Tooltip permanent className="!bg-gray-900 !text-green-400 !border-green-800 !text-xs">
            🏠 Home {h.years.join(', ')}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

interface MapPlace extends PlaceSummary {
  center: LatLngTuple;
  radius: number;
  /** Start of the first day visited in the range, in playback time */
  firstVisit: number;
}

/** The given places (visited in the range), ordered by their first visit in it. */
function placesByFirstVisit(visits: Visit[], places: PlaceSummary[], range: DateRange): MapPlace[] {
  const wanted = new Map(places.map((p) => [p.placeId, p]));
  const result: MapPlace[] = [];
  for (const v of visits) {
    const p = wanted.get(v.placeId);
    if (!p) continue;
    let first: string | null = null;
    for (const [date] of v.stays) {
      if (inRange(date, range) && (first === null || date < first)) first = date;
    }
    result.push({
      ...p,
      center: [p.lat, p.lng],
      radius: Math.min(2 + Math.log2(p.visitCount + 1) * 1.5, 10),
      firstVisit: first ? dateStartTime(first) : -Infinity,
    });
  }
  return result.sort((a, b) => a.firstVisit - b.firstVisit);
}

const PLACE_PATH: PathOptions = { color: '#10b981', fillColor: '#10b981', fillOpacity: 0.5, weight: 0.5 };

const PlaceMarker = memo(function PlaceMarker({ place: v }: { place: MapPlace }) {
  return (
    <CircleMarker center={v.center} radius={v.radius} pathOptions={PLACE_PATH}>
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
  );
});

/**
 * Place markers; during playback each appears on its first visit in the
 * range. The elements are created once, so a marker appearing (many times a
 * second at fast speeds) only mounts that marker.
 */
function PlaceMarkers({ places, clock }: { places: MapPlace[]; clock: PlaybackClock | null }) {
  const firstVisits = useMemo(() => places.map((p) => p.firstVisit), [places]);
  const markers = useMemo(() => places.map((p) => <PlaceMarker key={p.placeId} place={p} />), [places]);
  const shown = usePlaybackSelect(clock, (time) => countUpTo(firstVisits, time), places.length);
  return <>{markers.slice(0, shown)}</>;
}

export default function TravelMap() {
  const { data: routes, loading: rl, error } = useRoutes();
  const { data: visits, loading: vl } = useVisits();
  const { data: homeData } = useHomePeriods();
  // Both optional: family homes are missing from older exports (fetch fails)
  const { data: familyHomeData, loading: fhl } = useFamilyHomes();
  const { data: nights, loading: nl } = useNightsAway();
  const { range } = useTimeRange();

  const staleHome = !!homeData && isStaleHome(homeData);
  const allHomePeriods = useMemo(() => (homeData && !staleHome ? homeData : []), [homeData, staleHome]);
  const homePeriods = useMemo(() => homePeriodsInRange(allHomePeriods, range), [allHomePeriods, range]);
  const latestHome = homePeriods.at(-1);

  // Family homes with a night spent there in the range
  const familyHomes = useMemo(
    () => (familyHomeData?.length && nights ? familyHomesInRange(familyHomeData, nights, range) : []),
    [familyHomeData, nights, range],
  );

  const routeIndex = useMemo(() => (routes ? buildRouteIndex(routes) : null), [routes]);

  const allModes = useMemo(() => (routeIndex ? [...new Set(routeIndex.mode)].sort() : []), [routeIndex]);

  // Layer toggles and playback live in the URL as differences from the defaults
  const { params } = useRoute();
  const modeOverrides = useMemo(
    () => parseModeOverrides(params.show, params.hide),
    [params.show, params.hide],
  );
  const showVisits = params.places !== 'off';
  const playbackOpen = params.playback === 'on';

  const activeModes = useMemo(() => {
    const active = new Set(allModes.filter(isDefaultMode));
    for (const [mode, on] of modeOverrides) {
      if (on) active.add(mode);
      else active.delete(mode);
    }
    return active;
  }, [allModes, modeOverrides]);

  const selection = useMemo(
    () => (routeIndex ? selectRoutes(routeIndex, range, activeModes) : null),
    [routeIndex, range, activeModes],
  );

  // Playback spans the range's routes (any mode); null when it has none
  const bounds = useMemo(() => (routeIndex ? playbackBounds(routeIndex, range) : null), [routeIndex, range]);

  // Places visited in the range, most visited (in the range) first;
  // visit counts and hours on the markers are for the range too
  const rangePlaces = useMemo(
    () => (visits ? summarizeVisits(visits, range).places.filter((p) => !isHomePlace(p.semanticType)) : []),
    [visits, range],
  );

  const places = useMemo(
    () => (visits && showVisits ? placesByFirstVisit(visits, rangePlaces.slice(0, 500), range) : []), // cap for performance
    [visits, rangePlaces, showVisits, range],
  );

  // Gather some bounds points from the drawn routes; only fitted when there are routes
  const boundsCoords = useMemo((): [number, number][] => {
    const pts: [number, number][] = [];
    if (!routeIndex || !selection) return pts;
    for (const i of selection.positions.subarray(0, 200)) {
      const { points } = routeIndex.routes[i];
      if (points.length > 0) {
        pts.push(points[0]);
        pts.push(points[points.length - 1]);
      }
    }
    if (pts.length === 0) return pts;
    return [
      ...homePeriods.map((h): [number, number] => [h.lat, h.lng]),
      ...familyHomes.map((h): [number, number] => [h.lat, h.lng]),
      ...pts,
    ];
  }, [routeIndex, selection, homePeriods, familyHomes]);

  // Playback: the clock is per page visit; the speed defaults to one that
  // plays the whole range in about a minute until one is picked
  const [clock] = useState(() => new PlaybackClock());
  const [pickedSpeed, setPickedSpeed] = useState<PlaybackSpeed | null>(null);
  const speed = pickedSpeed ?? autoSpeed(bounds ? bounds.end - bounds.start : 0);

  useEffect(() => {
    if (bounds) clock.configure(bounds, speed);
  }, [clock, bounds, speed]);

  // Stop the animation loop when playback closes (also via back/forward) or the page unmounts
  useEffect(() => {
    if (!playbackOpen) clock.pause();
  }, [clock, playbackOpen]);
  useEffect(() => () => clock.pause(), [clock]);

  if (rl || vl || fhl || nl) return <Loader />;
  if (!routes || !routeIndex || !selection) return <EmptyState error={error} />;

  const toggleMode = (mode: string) => {
    const on = !activeModes.has(mode);
    const next = new Map(modeOverrides);
    if (on === isDefaultMode(mode)) next.delete(mode);
    else next.set(mode, on);
    setParams(modeOverridesToParams(next), { replace: true });
  };

  const togglePlayback = () => {
    if (playbackOpen) {
      clock.pause();
      setParams({ playback: null }, { replace: true });
    } else if (bounds) {
      setParams({ playback: 'on' }, { replace: true });
      clock.seek(bounds.start);
      clock.play();
    }
  };

  const hasDataInRange = bounds !== null || rangePlaces.length > 0;
  const playbackClock = playbackOpen && bounds ? clock : null;

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
          onClick={() => setParams({ places: showVisits ? 'off' : null }, { replace: true })}
          className={`text-xs px-2 py-1 rounded-md border transition-colors ${
            showVisits
              ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
              : 'border-gray-700 text-gray-600'
          }`}
        >
          📍 Places
        </button>

        <button
          type="button"
          onClick={togglePlayback}
          disabled={!bounds}
          aria-pressed={playbackOpen}
          title={playbackOpen ? 'Close playback' : 'Play the range back and watch it draw itself'}
          className={`text-xs px-2 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            playbackOpen
              ? 'border-orange-500/50 text-orange-300 bg-orange-500/10'
              : 'border-gray-700 text-gray-300 hover:text-white hover:border-gray-600'
          }`}
        >
          ▶ Playback
        </button>

        {staleHome && (
          <span className="text-xs text-gray-400">
            <RegenerateHint /> to show your homes
          </span>
        )}

        <span className="text-xs text-gray-500 ml-auto">
          {selection.positions.length} segments
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
        <div className="relative flex-1 isolate">
          <MapContainer
            center={latestHome ? [latestHome.lat, latestHome.lng] : [30, 0]}
            zoom={5}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
            preferCanvas={true}
          >
            <DarkBasemap />
            {boundsCoords.length > 0 && <FitBounds coords={boundsCoords} />}

            {/* Family-home rings, one per family home stayed at in the range. Drawn
                first, so a home at the same spot (after moving in) sits on top,
                and labelled below the point, clear of the home's label */}
            {familyHomes.map((h) => (
              <CircleMarker
                key={`family-${h.lat},${h.lng}`}
                center={[h.lat, h.lng]}
                radius={9}
                pathOptions={{ color: FAMILY_HOME_COLOR, fillColor: FAMILY_HOME_COLOR, fillOpacity: 0.15, weight: 2.5 }}
              >
                <Tooltip
                  permanent
                  direction="bottom"
                  offset={[0, 8]}
                  className="!bg-gray-900 !text-teal-300 !border-teal-800 !text-xs"
                >
                  🏡 {h.label} · family home
                </Tooltip>
              </CircleMarker>
            ))}

            <RouteLayer
              index={routeIndex}
              selection={selection}
              clock={playbackClock}
              trailSpan={speed.days * DAY_MS * TRAIL_SECONDS}
            />
            <HomeMarkers allPeriods={allHomePeriods} periods={homePeriods} range={range} clock={playbackClock} />
            <PlaceMarkers places={places} clock={playbackClock} />
          </MapContainer>

          {playbackOpen && bounds && (
            <PlaybackBar
              clock={clock}
              bounds={bounds}
              speed={speed}
              onSpeedChange={setPickedSpeed}
              onClose={togglePlayback}
              times={selection.times}
            />
          )}
        </div>
      )}
    </div>
  );
}
