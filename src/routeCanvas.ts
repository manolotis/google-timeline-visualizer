/**
 * The Travel Map's route layer: draws a RouteSelection onto canvases, up to
 * a playback time, so the history can draw itself.
 *
 * Why not one Leaflet polyline per segment: creating ~15k Leaflet paths (and
 * React components) is slow, and Leaflet's canvas renderer repaints every
 * path crossing a changed area, so appending one segment in a dense city
 * repaints thousands of them. This layer positions and zoom-animates its
 * canvases the way Leaflet's renderers do, but draws straight from the
 * packed RouteIndex onto two canvases:
 *
 * - base: every selected segment that started by the playback time, in the
 *   normal route style. It only ever accumulates: moving forward draws just
 *   the segments passed since the last frame. Moving backward, a new
 *   selection, or the end of a pan/zoom repaints it from scratch.
 * - trail: redrawn every frame. The segments of the last TRAIL_SECONDS of
 *   playback, wider and brighter, fading into the normal style as they age,
 *   plus a dot where the newest segment ended (the current position).
 *
 * Outside playback the time is +Infinity: the base holds every segment and
 * the trail is empty, so the static map is simply a finished playback.
 */
import {
  DomUtil,
  Layer,
  point,
  type LatLng,
  type LeafletEventHandlerFn,
  type Map as LeafletMap,
  type ZoomAnimEvent,
} from 'leaflet';
import { FALLBACK_MODE_COLOR, MODE_COLORS } from './constants';
import { countUpTo } from './playback';
import type { RouteIndex, RouteSelection } from './routeIndex';

/**
 * Own panes, both ignoring the pointer so markers stay hoverable: the base
 * below the overlay pane (place and home markers on top, as before), the
 * trail above it, so the current position isn't hidden under a marker (but
 * below the tooltips).
 */
const BASE_PANE = { name: 'routes', zIndex: '350' };
const TRAIL_PANE = { name: 'routes-trail', zIndex: '450' };

/** Canvas margin around the view, as a fraction of its size (like Leaflet's renderers), so a short pan shows no blank edge. */
const PADDING = 0.1;

const ROUTE_OPACITY = 0.4;
const TRAIL_EXTRA_WIDTH = 2.5;
const HEAD_RADIUS = 3.5;
const HEAD_HALO_RADIUS = 9;

const routeColor = (mode: string) => MODE_COLORS[mode] || FALLBACK_MODE_COLOR;
const routeWidth = (mode: string) => (mode === 'FLYING' ? 1.5 : 1);

/** The canvases' geometry, fixed between resets. */
interface View {
  /** Absolute pixel position of the canvas' top-left corner at `zoom` */
  x: number;
  y: number;
  /** CSS pixels */
  width: number;
  height: number;
  zoom: number;
  /** World (zoom 0) → pixels at `zoom` */
  scale: number;
  /** The canvas plus a small margin, in world coordinates, for culling */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY_SELECTION: RouteSelection = { positions: new Uint32Array(0), times: new Float64Array(0) };

export class RouteCanvasLayer extends Layer {
  private index: RouteIndex | null = null;
  private selection = EMPTY_SELECTION;
  private time = Infinity;
  /** Playback ms a segment stays emphasized */
  private trailSpan = 0;
  /** How many selected segments (a chronological prefix) the base canvas holds */
  private drawn = 0;

  private map: LeafletMap | null = null;
  private base: CanvasRenderingContext2D | null = null;
  private trail: CanvasRenderingContext2D | null = null;
  private view: View | null = null;
  /** What the trail canvas painted last frame (CSS px), cleared before the next */
  private trailDirty: { x0: number; y0: number; x1: number; y1: number } | null = null;

  private readonly events: Record<string, LeafletEventHandlerFn> = {
    viewreset: () => this.reset(),
    moveend: () => this.reset(),
    // Pinch zoom
    zoom: () => {
      if (this.map) this.transform(this.map.getCenter(), this.map.getZoom());
    },
    zoomanim: (e) => {
      const { center, zoom } = e as ZoomAnimEvent;
      this.transform(center, zoom);
    },
  };

  getEvents(): Record<string, LeafletEventHandlerFn> {
    return this.events;
  }

  onAdd(map: LeafletMap): this {
    this.map = map;
    const canvasIn = ({ name, zIndex }: { name: string; zIndex: string }) => {
      let pane = map.getPane(name);
      if (!pane) {
        pane = map.createPane(name);
        pane.style.zIndex = zIndex;
        pane.style.pointerEvents = 'none';
      }
      return DomUtil.create('canvas', 'leaflet-zoom-animated', pane).getContext('2d');
    };
    this.base = canvasIn(BASE_PANE);
    this.trail = canvasIn(TRAIL_PANE);
    this.reset();
    return this;
  }

  onRemove(): this {
    this.base?.canvas.remove();
    this.trail?.canvas.remove();
    this.base = this.trail = this.view = this.map = null;
    this.trailDirty = null;
    this.drawn = 0;
    return this;
  }

  setSelection(index: RouteIndex, selection: RouteSelection): void {
    if (index === this.index && selection === this.selection) return;
    this.index = index;
    this.selection = selection;
    this.redrawBase();
    this.drawTrail();
  }

  /** Playback time; +Infinity shows everything, without a trail. */
  setTime(time: number): void {
    if (time === this.time) return;
    this.time = time;
    const upTo = countUpTo(this.selection.times, time);
    if (upTo >= this.drawn) this.drawBase(upTo);
    else this.redrawBase();
    this.drawTrail();
  }

  setTrailSpan(span: number): void {
    if (span === this.trailSpan) return;
    this.trailSpan = span;
    this.drawTrail();
  }

  // -------------------------------------------------------------------------
  // Positioning (mirrors Leaflet's Renderer)
  // -------------------------------------------------------------------------

  /** After a pan, zoom or resize: cover the view again and repaint. */
  private reset(): void {
    const { map, base, trail } = this;
    if (!map || !base || !trail) return;

    const size = map.getSize();
    const pad = size.multiplyBy(PADDING).round();
    const topLeft = map.containerPointToLayerPoint(pad.multiplyBy(-1)).round();

    const origin = map.getPixelOrigin();
    const zoom = map.getZoom();
    const scale = map.getZoomScale(zoom, 0);
    const width = size.x + 2 * pad.x;
    const height = size.y + 2 * pad.y;
    const x = topLeft.x + origin.x;
    const y = topLeft.y + origin.y;
    const margin = 10; // px, covers line widths and the head dot
    this.view = {
      x,
      y,
      width,
      height,
      zoom,
      scale,
      minX: (x - margin) / scale,
      minY: (y - margin) / scale,
      maxX: (x + width + margin) / scale,
      maxY: (y + height + margin) / scale,
    };

    const dpr = window.devicePixelRatio || 1;
    for (const ctx of [base, trail]) {
      DomUtil.setPosition(ctx.canvas, topLeft);
      // Resizing clears the canvas and resets the context
      ctx.canvas.width = Math.round(width * dpr);
      ctx.canvas.height = Math.round(height * dpr);
      ctx.canvas.style.width = `${width}px`;
      ctx.canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    this.trailDirty = null;
    this.drawn = 0;
    this.drawBase(countUpTo(this.selection.times, this.time));
    this.drawTrail();
  }

  /** During a zoom animation (or pinch): scale the current bitmap like the tiles. */
  private transform(center: LatLng, zoom: number): void {
    const { map, base, trail, view } = this;
    if (!map || !base || !trail || !view) return;
    const scale = map.getZoomScale(zoom, view.zoom);
    // The pixel origin the map will have at (center, zoom), as Map._getNewPixelOrigin
    const mapPane = map.getPane('mapPane');
    const panePos = mapPane ? DomUtil.getPosition(mapPane) : point(0, 0);
    const origin = map.project(center, zoom).subtract(map.getSize().divideBy(2)).add(panePos).round();
    const offset = point(view.x * scale - origin.x, view.y * scale - origin.y);
    DomUtil.setTransform(base.canvas, offset, scale);
    DomUtil.setTransform(trail.canvas, offset, scale);
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private isVisible(i: number): boolean {
    const { view, index } = this;
    if (!view || !index) return false;
    const b = i * 4;
    const bbox = index.bbox;
    return bbox[b] <= view.maxX && bbox[b + 2] >= view.minX && bbox[b + 1] <= view.maxY && bbox[b + 3] >= view.minY;
  }

  /** Starts a path along segment i, in canvas CSS pixels. */
  private tracePath(ctx: CanvasRenderingContext2D, index: RouteIndex, view: View, i: number): void {
    const { xy, pointStart } = index;
    const { x, y, scale } = view;
    let p = pointStart[i];
    const end = pointStart[i + 1];
    ctx.beginPath();
    ctx.moveTo(xy[2 * p] * scale - x, xy[2 * p + 1] * scale - y);
    for (p++; p < end; p++) ctx.lineTo(xy[2 * p] * scale - x, xy[2 * p + 1] * scale - y);
  }

  private redrawBase(): void {
    const { base, view } = this;
    if (base && view) base.clearRect(0, 0, view.width, view.height);
    this.drawn = 0;
    this.drawBase(countUpTo(this.selection.times, this.time));
  }

  /** Adds the selected segments [drawn, upTo) to the base canvas. */
  private drawBase(upTo: number): void {
    const { base: ctx, index, view } = this;
    if (!ctx || !index || !view) return;
    const { positions } = this.selection;
    ctx.globalAlpha = ROUTE_OPACITY;
    let style = '';
    for (let k = this.drawn; k < upTo; k++) {
      const i = positions[k];
      if (!this.isVisible(i)) continue;
      const mode = index.mode[i];
      if (mode !== style) {
        ctx.strokeStyle = routeColor(mode);
        ctx.lineWidth = routeWidth(mode);
        style = mode;
      }
      this.tracePath(ctx, index, view, i);
      ctx.stroke();
    }
    this.drawn = upTo;
  }

  /** Repaints the emphasized recent segments and the current-position dot. */
  private drawTrail(): void {
    const { trail: ctx, index, view } = this;
    if (!ctx || !view) return;
    if (this.trailDirty) {
      const { x0, y0, x1, y1 } = this.trailDirty;
      if (x1 > x0 && y1 > y0) ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      this.trailDirty = null;
    }
    const { positions, times } = this.selection;
    const upTo = countUpTo(times, this.time);
    if (!index || !Number.isFinite(this.time) || upTo === 0) return;

    const { x, y, scale } = view;
    const dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const touch = (b: number, pad: number) => {
      const bbox = index.bbox;
      dirty.x0 = Math.min(dirty.x0, bbox[b] * scale - x - pad);
      dirty.y0 = Math.min(dirty.y0, bbox[b + 1] * scale - y - pad);
      dirty.x1 = Math.max(dirty.x1, bbox[b + 2] * scale - x + pad);
      dirty.y1 = Math.max(dirty.y1, bbox[b + 3] * scale - y + pad);
    };

    // Oldest first, so the newest ends up on top
    const span = this.trailSpan;
    for (let k = span > 0 ? countUpTo(times, this.time - span) : upTo; k < upTo; k++) {
      const i = positions[k];
      if (!this.isVisible(i)) continue;
      const strength = 1 - (this.time - times[k]) / span; // 1 = just started → 0 = settled
      const mode = index.mode[i];
      this.tracePath(ctx, index, view, i);
      ctx.globalAlpha = strength;
      ctx.strokeStyle = routeColor(mode);
      ctx.lineWidth = routeWidth(mode) + TRAIL_EXTRA_WIDTH * strength;
      ctx.stroke();
      // A white-hot core while it's new
      if (strength > 0.5) {
        ctx.globalAlpha = (strength - 0.5) * 1.6;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = routeWidth(mode) * 0.75;
        ctx.stroke();
      }
      touch(i * 4, 6);
    }

    // Current position: where the newest segment ended
    const last = positions[upTo - 1];
    const p = index.pointStart[last + 1] - 1;
    const px = index.xy[2 * p] * scale - x;
    const py = index.xy[2 * p + 1] * scale - y;
    const color = routeColor(index.mode[last]);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, HEAD_HALO_RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, HEAD_RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    const r = HEAD_HALO_RADIUS + 2;
    dirty.x0 = Math.min(dirty.x0, px - r);
    dirty.y0 = Math.min(dirty.y0, py - r);
    dirty.x1 = Math.max(dirty.x1, px + r);
    dirty.y1 = Math.max(dirty.y1, py + r);

    this.trailDirty = {
      x0: Math.floor(Math.max(dirty.x0, 0)),
      y0: Math.floor(Math.max(dirty.y0, 0)),
      x1: Math.ceil(Math.min(dirty.x1, view.width)),
      y1: Math.ceil(Math.min(dirty.y1, view.height)),
    };
  }
}
