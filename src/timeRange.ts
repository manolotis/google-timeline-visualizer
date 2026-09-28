/**
 * Global time-range filter: selection model, React context, and the pure
 * date helpers every page uses to restrict its data to the selected range.
 *
 * Dates are 'YYYY-MM-DD' strings, which compare chronologically as plain
 * strings. They are local calendar dates where the user was (see types.ts),
 * so filtering is pure calendar arithmetic: nothing here depends on the
 * browser's time zone. A null bound is open-ended, so "All time" is
 * { start: null, end: null }: it excludes nothing and reproduces the
 * unfiltered numbers exactly.
 *
 * The provider lives in components/TimeRangeProvider.tsx and the top-bar UI
 * in components/TimeRangeControl.tsx. The selection itself is stored in the
 * URL hash (route.ts), encoded by selectionToParams below.
 */
import { createContext, useContext } from 'react';
import type { Stats } from './types';

/** Inclusive date range; null bounds are open-ended. */
export interface DateRange {
  start: string | null;
  end: string | null;
}

/** What the user picked in the top-bar control. */
export type RangeSelection =
  | { kind: 'all' }
  | { kind: 'last12' }
  | { kind: 'year'; year: number }
  /** Raw date-input values; '' leaves that side open */
  | { kind: 'custom'; start: string; end: string };

/** First and last day with data. */
export interface DataBounds {
  start: string;
  end: string;
}

export interface TimeRangeContextValue {
  selection: RangeSelection;
  setSelection: (selection: RangeSelection) => void;
  /** Effective range to filter by */
  range: DateRange;
  /** Known once stats.json has loaded; null while loading or if it is missing */
  bounds: DataBounds | null;
  /** Short label, e.g. "All time", "2024", "2024-03-01 → 2024-06-30" */
  label: string;
  /** False when a custom start date is after the end date */
  valid: boolean;
}

export const TimeRangeContext = createContext<TimeRangeContextValue>({
  selection: { kind: 'all' },
  setSelection: () => {},
  range: { start: null, end: null },
  bounds: null,
  label: 'All time',
  valid: true,
});

export function useTimeRange(): TimeRangeContextValue {
  return useContext(TimeRangeContext);
}

// ---------------------------------------------------------------------------
// Selection → range
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 (pure calendar arithmetic, no timezone involved). */
export function dayNumber(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;
}

/** The date `days` days after `date` (negative goes back). */
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a 'YYYY-MM-DD' date. */
export function dayOfWeek(date: string): number {
  // 1970-01-01 was a Thursday
  return (((dayNumber(date) + 4) % 7) + 7) % 7;
}

/** The day after the same date one year earlier ('2026-09-25' → '2025-09-26'). */
function yearBefore(date: string): string {
  const d = Date.UTC(+date.slice(0, 4) - 1, +date.slice(5, 7) - 1, +date.slice(8, 10));
  return new Date(d + DAY_MS).toISOString().slice(0, 10);
}

export function statsBounds(stats: Stats): DataBounds {
  return {
    start: stats.dateRange.start.slice(0, 10),
    end: stats.dateRange.end.slice(0, 10),
  };
}

/** Years covered by the data, newest first. */
export function boundsYears(bounds: DataBounds): number[] {
  const years: number[] = [];
  for (let y = +bounds.end.slice(0, 4); y >= +bounds.start.slice(0, 4); y--) years.push(y);
  return years;
}

export function selectionRange(selection: RangeSelection, bounds: DataBounds | null): DateRange {
  switch (selection.kind) {
    case 'all':
      return { start: null, end: null };
    case 'last12':
      // Relative to the newest data rather than today, so a stale export
      // still shows a full year
      return bounds ? { start: yearBefore(bounds.end), end: bounds.end } : { start: null, end: null };
    case 'year':
      return { start: `${selection.year}-01-01`, end: `${selection.year}-12-31` };
    case 'custom':
      return { start: selection.start || null, end: selection.end || null };
  }
}

export function selectionLabel(selection: RangeSelection, range: DateRange): string {
  switch (selection.kind) {
    case 'all':
      return 'All time';
    case 'last12':
      return 'Last 12 months';
    case 'year':
      return String(selection.year);
    case 'custom':
      if (range.start && range.end) return `${range.start} → ${range.end}`;
      if (range.start) return `From ${range.start}`;
      if (range.end) return `Until ${range.end}`;
      return 'All time';
  }
}

export function isValidRange(range: DateRange): boolean {
  return !(range.start !== null && range.end !== null && range.start > range.end);
}

// ---------------------------------------------------------------------------
// URL params (the global part of the hash route, see route.ts)
// ---------------------------------------------------------------------------

/**
 * How a selection appears in the URL; All time has no params:
 *   last12  → range=last12m
 *   year    → range=2024
 *   custom  → from=2024-03-01&to=2024-06-30 (either side may be absent)
 */
export type RangeParams = {
  range?: string;
  from?: string;
  to?: string;
};

/** The range param names, in the order URLs list them (before any page params). */
export const RANGE_PARAM_KEYS: readonly (keyof RangeParams)[] = ['range', 'from', 'to'];

/** Every range param set to null: spread a selection's params over it to replace the range. */
export const CLEARED_RANGE_PARAMS: Readonly<Record<keyof RangeParams, null>> = {
  range: null,
  from: null,
  to: null,
};

const LAST_12_PARAM = 'last12m';

/** A real calendar date in 'YYYY-MM-DD' form. */
export function isIsoDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function selectionToParams(selection: RangeSelection): RangeParams {
  switch (selection.kind) {
    case 'all':
      return {};
    case 'last12':
      return { range: LAST_12_PARAM };
    case 'year':
      return { range: String(selection.year) };
    case 'custom': {
      const params: RangeParams = {};
      if (selection.start) params.from = selection.start;
      if (selection.end) params.to = selection.end;
      return params;
    }
  }
}

/** Inverse of selectionToParams; anything unrecognized means All time. */
export function selectionFromParams({ range, from, to }: RangeParams): RangeSelection {
  if (range === LAST_12_PARAM) return { kind: 'last12' };
  if (range && /^[1-9]\d{3}$/.test(range)) return { kind: 'year', year: +range };
  const start = isIsoDate(from) ? from : '';
  const end = isIsoDate(to) ? to : '';
  return start || end ? { kind: 'custom', start, end } : { kind: 'all' };
}

/** Whether two selections have the same URL, i.e. would filter identically. */
export function sameRangeParams(a: RangeSelection, b: RangeSelection): boolean {
  const pa = selectionToParams(a);
  const pb = selectionToParams(b);
  return RANGE_PARAM_KEYS.every((key) => pa[key] === pb[key]);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function inRange(date: string, range: DateRange): boolean {
  return (range.start === null || date >= range.start) && (range.end === null || date <= range.end);
}

/** Whether the inclusive span [start, end] (e.g. a trip) intersects the range. */
export function overlapsRange(start: string, end: string, range: DateRange): boolean {
  return (
    isValidRange(range) &&
    (range.start === null || end >= range.start) &&
    (range.end === null || start <= range.end)
  );
}

/** Intersection of two ranges; an open bound defers to the other range. */
export function intersectRanges(a: DateRange, b: DateRange): DateRange {
  const start =
    a.start === null ? b.start : b.start === null ? a.start : a.start > b.start ? a.start : b.start;
  const end = a.end === null ? b.end : b.end === null ? a.end : a.end < b.end ? a.end : b.end;
  return { start, end };
}

export function yearRange(year: number): DateRange {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

// ---------------------------------------------------------------------------
// Chart periods
// ---------------------------------------------------------------------------

export type Granularity = 'year' | 'month';

export interface Periods {
  granularity: Granularity;
  /** Period keys ('YYYY' or 'YYYY-MM') covering the range clipped to the data, in order */
  keys: string[];
}

/** Ranges spanning at most this many months are charted per month instead of per year. */
const MAX_MONTHLY_PERIODS = 36;

export function rangePeriods(range: DateRange, bounds: DataBounds): Periods {
  const { start, end } = intersectRanges(range, bounds);
  if (start === null || end === null || start > end) return { granularity: 'year', keys: [] };

  const sy = +start.slice(0, 4);
  const sm = +start.slice(5, 7) - 1;
  const ey = +end.slice(0, 4);
  const em = +end.slice(5, 7) - 1;
  const months = (ey - sy) * 12 + (em - sm) + 1;

  const keys: string[] = [];
  if (months <= MAX_MONTHLY_PERIODS) {
    for (let i = sm; i < sm + months; i++) {
      keys.push(`${sy + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`);
    }
    return { granularity: 'month', keys };
  }
  for (let y = sy; y <= ey; y++) keys.push(String(y));
  return { granularity: 'year', keys };
}

export function periodKey(date: string, granularity: Granularity): string {
  return granularity === 'year' ? date.slice(0, 4) : date.slice(0, 7);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2024' → '2024', '2024-03' → 'Mar 2024' */
export function periodLabel(key: string): string {
  return key.length === 4 ? key : `${MONTH_NAMES[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
}

/** "Year" / "Month", for chart titles. */
export function periodNoun(periods: Periods): string {
  return periods.granularity === 'year' ? 'Year' : 'Month';
}
