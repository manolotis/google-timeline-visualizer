/**
 * Travel Map playback: the clock that moves a date through the selected
 * range, its speed presets, and hooks for reading it.
 *
 * Playback time is event-local wall-clock time in ms: a segment that started
 * at '2024-03-14T09:30:00+01:00' happened at Date.UTC(2024, 2, 14, 9, 30),
 * so the date shown for a time (its UTC calendar date) is the same
 * event-local date the rest of the app filters by.
 *
 * The clock is a tiny external store (like route.ts) advanced by its own
 * requestAnimationFrame loop. The playback position changes every frame, so
 * it is deliberately not React state of the page: the route canvas redraws
 * from a subscription, the playback bar re-renders on its own, and markers
 * subscribe through usePlaybackSelect, re-rendering only when what they show
 * changes. The position is ephemeral (never in the URL).
 */
import { useSyncExternalStore } from 'react';

export const DAY_MS = 86_400_000;

export interface PlaybackSpeed {
  id: string;
  /** "1 month" (per second) */
  label: string;
  /** Compact button label, "1m" */
  short: string;
  /** Days of history played per second */
  days: number;
}

export const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [
  { id: 'day', label: '1 day', short: '1d', days: 1 },
  { id: 'week', label: '1 week', short: '1w', days: 7 },
  { id: 'month', label: '1 month', short: '1m', days: 365.25 / 12 },
  { id: 'quarter', label: '3 months', short: '3m', days: 365.25 / 4 },
  { id: 'year', label: '1 year', short: '1y', days: 365.25 },
];

/** The default speed plays the whole range in at most this long. */
const AUTO_MAX_SECONDS = 60;

/** Slowest speed that plays a span of `spanMs` within a minute (all time → 3 months/s, a year → 1 week/s). */
export function autoSpeed(spanMs: number): PlaybackSpeed {
  return (
    PLAYBACK_SPEEDS.find((s) => spanMs / (s.days * DAY_MS) <= AUTO_MAX_SECONDS) ??
    PLAYBACK_SPEEDS[PLAYBACK_SPEEDS.length - 1]
  );
}

/** How long, in seconds of playback, a new segment stays emphasized. */
export const TRAIL_SECONDS = 1;

/** Inclusive playback span, in playback-time ms. */
export interface PlaybackBounds {
  start: number;
  end: number;
}

export interface PlaybackState {
  readonly time: number;
  readonly playing: boolean;
}

/** Longest frame step: after a stall (e.g. a background tab) playback resumes instead of jumping. */
const MAX_FRAME_MS = 100;

export class PlaybackClock {
  private state: PlaybackState = { time: -Infinity, playing: false };
  private readonly listeners = new Set<() => void>();
  private bounds: PlaybackBounds = { start: 0, end: 0 };
  /** Playback ms per real ms */
  private rate = 0;
  private frame = 0;
  private lastTick: number | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PlaybackState => this.state;

  /** Sets the span and speed; the position is clamped into the new span. */
  configure(bounds: PlaybackBounds, speed: PlaybackSpeed): void {
    this.bounds = bounds;
    this.rate = (speed.days * DAY_MS) / 1000;
    this.set(this.clamp(this.state.time), this.state.playing);
  }

  /** Plays from the current position, or from the start when at the end. */
  play(): void {
    const time = this.state.time >= this.bounds.end ? this.bounds.start : this.state.time;
    this.set(time, true);
    this.lastTick = null;
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.set(this.state.time, false);
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.set(this.clamp(time), this.state.playing);
  }

  private clamp(time: number): number {
    return Math.min(Math.max(time, this.bounds.start), this.bounds.end);
  }

  private set(time: number, playing: boolean): void {
    if (time === this.state.time && playing === this.state.playing) return;
    this.state = { time, playing };
    for (const listener of this.listeners) listener();
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (!this.state.playing) return;
    const dt = this.lastTick === null ? 0 : Math.min(now - this.lastTick, MAX_FRAME_MS);
    this.lastTick = now;
    const time = Math.min(this.state.time + dt * this.rate, this.bounds.end);
    // Stops at the end, so the finished picture stays up
    const playing = time < this.bounds.end;
    this.set(time, playing);
    if (playing) this.frame = requestAnimationFrame(this.tick);
  };
}

const noSubscribe = () => () => {};

/** The clock's position and play state; re-renders every frame while playing. */
export function usePlaybackState(clock: PlaybackClock): PlaybackState {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot);
}

/**
 * A value derived from the playback time, e.g. how many markers have
 * appeared by now; `select` must return a primitive, and the component only
 * re-renders when it changes. Without playback (`clock` null) it is
 * `whenStopped`.
 */
export function usePlaybackSelect<T extends string | number | boolean>(
  clock: PlaybackClock | null,
  select: (time: number) => T,
  whenStopped: T,
): T {
  return useSyncExternalStore(clock ? clock.subscribe : noSubscribe, () =>
    clock ? select(clock.getSnapshot().time) : whenStopped,
  );
}

/** How many of the ascending `times` are ≤ `time` (binary search). */
export function countUpTo(times: ArrayLike<number>, time: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Playback time → 'YYYY-MM-DD' (the event-local date). */
export function playbackDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Start of an event-local date, in playback time. */
export function dateStartTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * An ISO timestamp's event-local wall-clock time, as playback time:
 * '2024-03-14T09:30:00.000+01:00' → Date.UTC(2024, 2, 14, 9, 30).
 */
export function localTime(timestamp: string): number {
  const time = Date.parse(`${timestamp.slice(0, 19)}Z`);
  return Number.isNaN(time) ? dateStartTime(timestamp.slice(0, 10)) || 0 : time;
}
