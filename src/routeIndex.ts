/**
 * routes.json packed for fast drawing: every segment in chronological order,
 * with its points pre-projected to world pixels, in flat typed arrays. Built
 * once per load; filtering by range and mode then only produces a list of
 * positions (a RouteSelection), and drawing needs one multiply-add per
 * coordinate at any zoom (see routeCanvas.ts).
 */
import { CRS, latLng } from 'leaflet';
import { countUpTo, dateStartTime, DAY_MS, localTime, type PlaybackBounds } from './playback';
import { inRange, type DateRange } from './timeRange';
import type { RouteSegment } from './types';

export interface RouteIndex {
  count: number;
  /** The segments, chronological */
  routes: RouteSegment[];
  /** Start in playback time (event-local wall clock, see playback.ts), ascending */
  time: Float64Array;
  /** Event-local start date, 'YYYY-MM-DD' (the date the time range filters by) */
  date: string[];
  mode: string[];
  /** Segment i's points are [pointStart[i], pointStart[i + 1]) */
  pointStart: Uint32Array;
  /**
   * Interleaved x, y world pixel coordinates at zoom 0 (EPSG:3857, the map's
   * CRS, whose world is 256 px wide at zoom 0); multiply by the map's zoom
   * scale for pixels at any zoom
   */
  xy: Float64Array;
  /** Per segment minX, minY, maxX, maxY in the same coordinates, for culling */
  bbox: Float64Array;
}

export function buildRouteIndex(routes: RouteSegment[]): RouteIndex {
  const starts = routes.map((r) => localTime(r.startTime));
  // routes.json is ordered by timestamp string, which mixes UTC offsets
  const order = routes.map((_, i) => i).sort((a, b) => starts[a] - starts[b] || a - b);

  const count = routes.length;
  let points = 0;
  for (const r of routes) points += r.points.length;

  const index: RouteIndex = {
    count,
    routes: order.map((i) => routes[i]),
    time: new Float64Array(count),
    date: [],
    mode: [],
    pointStart: new Uint32Array(count + 1),
    xy: new Float64Array(points * 2),
    bbox: new Float64Array(count * 4),
  };

  let p = 0;
  for (let i = 0; i < count; i++) {
    const r = index.routes[i];
    index.time[i] = starts[order[i]];
    index.date.push(r.startTime.slice(0, 10));
    index.mode.push(r.mode);
    index.pointStart[i] = p;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lat, lng] of r.points) {
      const { x, y } = CRS.EPSG3857.latLngToPoint(latLng(lat, lng), 0);
      index.xy[p * 2] = x;
      index.xy[p * 2 + 1] = y;
      p++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    index.bbox.set([minX, minY, maxX, maxY], i * 4);
  }
  index.pointStart[count] = p;
  return index;
}

/** Positions in a RouteIndex to draw, chronological. */
export interface RouteSelection {
  positions: Uint32Array;
  /** Their start times (ascending), for binary search */
  times: Float64Array;
}

export function selectRoutes(index: RouteIndex, range: DateRange, modes: ReadonlySet<string>): RouteSelection {
  const picked: number[] = [];
  for (let i = 0; i < index.count; i++) {
    if (modes.has(index.mode[i]) && inRange(index.date[i], range)) picked.push(i);
  }
  const positions = Uint32Array.from(picked);
  return { positions, times: Float64Array.from(picked, (i) => index.time[i]) };
}

/**
 * The playback span for a range: from the first to the last day with a
 * segment in it, of any mode (so toggling modes doesn't move the scrubber).
 * Null when the range has no segments.
 */
export function playbackBounds(index: RouteIndex, range: DateRange): PlaybackBounds | null {
  // Dates are ascending, so the range is one contiguous run of the index
  const from = range.start === null ? 0 : countUpTo(index.time, dateStartTime(range.start) - 1);
  let first = -1;
  let last = -1;
  for (let i = from; i < index.count; i++) {
    if (range.end !== null && index.date[i] > range.end) break;
    if (!inRange(index.date[i], range)) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return null;
  return {
    start: dateStartTime(index.date[first]),
    end: dateStartTime(index.date[last]) + DAY_MS - 1,
  };
}
