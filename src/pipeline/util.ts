/**
 * Small helpers shared by the pipeline stages: coordinates, distances,
 * durations, calendar-day arithmetic and local time.
 */
import type { RawSegment } from './types';

export function parseLatLng(s: string): [number, number] {
  // "48.8583701°, 2.2944813°" → [48.8583701, 2.2944813]
  const parts = s.replace(/°/g, '').split(',').map((p) => parseFloat(p.trim()));
  return [parts[0], parts[1]];
}

/** Great-circle distance in km. */
export function haversineDist(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function durationMin(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60000;
}

export function durationSec(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
}

export const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a 'YYYY-MM-DD' key (calendar arithmetic, no timezone). */
export function dayNumber(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;
}

/** Inverse of dayNumber. */
export function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------
// The export writes every ISO timestamp in the exporting phone's time zone
// (a flight leaving San Francisco at 13:35 reads "…T22:35:57.000+01:00"), so
// a timestamp's own date prefix is not the local date where things happened.
// Each visit and activity also records the UTC offset where it started and
// ended (start/endTimeTimezoneUtcOffsetMinutes), and those are the source of
// truth for local time here. One convention everywhere:
//
//   - Every timestamp the pipeline emits is re-expressed in the offset where
//     it happened (localStart / localEnd), so its 'YYYY-MM-DD' prefix is the
//     local calendar date and its hour the local hour. Stays, activities,
//     flights (departure), routes and home samples are dated by that prefix.
//   - Days present (geography.json) count each local date a visit spans.
//   - Nights are keyed by the local date of the evening they begin (see
//     run.ts, §4).
//
// Segments without the offset fields (timelinePath-only ones) fall back to
// the offset written in the timestamp itself.

/** UTC offset in minutes written in an ISO timestamp ('+01:00' → 60, 'Z' → 0). */
export function isoOffsetMinutes(iso: string): number {
  const m = /([+-])(\d\d):(\d\d)$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** The same instant written in another UTC offset: ('…T22:35:57.000+01:00', -480) → '…T13:35:57.000-08:00'. */
export function withOffset(iso: string, offsetMinutes: number): string {
  const wallClock = new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wallClock}${offsetMinutes < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** UTC offset (minutes) where a segment started. */
export function startOffsetMinutes(s: RawSegment): number {
  return s.startTimeTimezoneUtcOffsetMinutes ?? isoOffsetMinutes(s.startTime);
}

/** UTC offset (minutes) where a segment ended. */
export function endOffsetMinutes(s: RawSegment): number {
  return s.endTimeTimezoneUtcOffsetMinutes ?? isoOffsetMinutes(s.endTime);
}

/** A segment's start in local time, e.g. '2024-12-10T13:35:57.000-08:00'. */
export function localStart(s: RawSegment): string {
  return withOffset(s.startTime, startOffsetMinutes(s));
}

/** A segment's end in local time. */
export function localEnd(s: RawSegment): string {
  return withOffset(s.endTime, endOffsetMinutes(s));
}

/** The 'YYYY-MM-DD' prefix: the local date, for a timestamp from localStart / localEnd. */
export function dateStr(iso: string): string {
  return iso.slice(0, 10);
}
