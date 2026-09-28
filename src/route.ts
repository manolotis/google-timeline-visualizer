/**
 * URL hash routing: the single source of truth for the page being shown,
 * the global time range, and a little per-page view state, so a reload, a
 * bookmark, or a shared link reproduces the view.
 *
 *   #/flights?range=2024&sort=distance
 *     page    time range  page-local view state
 *
 * A tiny external store over `location.hash`, read with
 * useSyncExternalStore (no router library): App picks the page from it,
 * TimeRangeProvider derives the range from it, and pages derive their view
 * state from it. Nothing is copied into React state, so nothing needs
 * syncing, and pages can keep unmounting on navigation.
 *
 * - Page changes are plain <a href="#/…"> links (the browser pushes a
 *   history entry); time-range changes push entries too, so back/forward
 *   steps through both. Per-page view state (sort order, selected year, map
 *   layers) replaces the current entry instead of flooding the history.
 * - Only non-default values are written: an untouched page is `#/overview`.
 * - The time-range params (`range`, `from`, `to`; encoded in timeRange.ts)
 *   are global and carried by the nav links; any other param belongs to the
 *   current page and is dropped when leaving it. Pages must not reuse the
 *   range keys.
 * - Anything unparseable falls back to defaults: an unknown page shows the
 *   Overview for all time, and each page ignores params it can't read.
 * - Trip detail pages are named by the trip's first night, which is stable
 *   across preprocess reruns: `#/trip?start=2024-03-14` (see tripHref). The
 *   page isn't in the nav; without a valid `start` it shows Nights Away.
 */
import { useSyncExternalStore } from 'react';
import { RANGE_PARAM_KEYS, isIsoDate } from './timeRange';

export const PAGES = ['overview', 'flights', 'nights', 'map', 'statistics', 'geography', 'compare', 'trip'] as const;

export type Page = (typeof PAGES)[number];

export const DEFAULT_PAGE: Page = 'overview';

/** Query params of the hash; empty values are dropped when parsing. */
export type RouteParams = Readonly<Record<string, string>>;

export interface Route {
  page: Page;
  params: RouteParams;
}

function isPage(slug: string): slug is Page {
  return (PAGES as readonly string[]).includes(slug);
}

const GLOBAL_KEYS: readonly string[] = RANGE_PARAM_KEYS;

// ---------------------------------------------------------------------------
// Parsing and serialization (pure)
// ---------------------------------------------------------------------------

/** '#/flights?sort=distance' → { page: 'flights', params: { sort: 'distance' } } */
export function parseHash(hash: string): Route {
  const body = hash.replace(/^#\/?/, '');
  const q = body.indexOf('?');
  const slug = (q === -1 ? body : body.slice(0, q)).replace(/\/+$/, '').toLowerCase();

  // An unknown page discards its params too: Overview, all time
  if (slug !== '' && !isPage(slug)) return { page: DEFAULT_PAGE, params: {} };

  const params: Record<string, string> = {};
  if (q !== -1) {
    for (const [key, value] of new URLSearchParams(body.slice(q + 1))) {
      if (value !== '') params[key] = value;
    }
  }

  // A trip page needs the trip's start date; without one, show the trip
  // list (Nights Away) for the same time range
  if (slug === 'trip' && !isIsoDate(params.start)) {
    const rangeParams: Record<string, string> = {};
    for (const key of GLOBAL_KEYS) if (Object.hasOwn(params, key)) rangeParams[key] = params[key];
    return { page: 'nights', params: rangeParams };
  }

  return { page: slug === '' ? DEFAULT_PAGE : slug, params };
}

/** Commas stay readable in list values like `hide=flying,in_bus`. */
function encode(s: string): string {
  return encodeURIComponent(s).replace(/%2C/gi, ',');
}

/**
 * The href for a route, e.g. '#/flights?range=2024&sort=distance'. The range
 * params always come first in a fixed order, so equal routes get equal
 * hrefs whatever order they were edited in.
 */
export function routeHref({ page, params }: Route): string {
  const keys = [
    ...GLOBAL_KEYS.filter((key) => Object.hasOwn(params, key)),
    ...Object.keys(params).filter((key) => !GLOBAL_KEYS.includes(key)),
  ];
  const query = keys
    .filter((key) => params[key] !== '')
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
  return `#/${page}${query ? `?${query}` : ''}`;
}

/**
 * The detail page of the trip whose first night is `start`; pass the
 * current range params so the range survives the round trip.
 */
export function tripHref(start: string, rangeParams: RouteParams): string {
  return routeHref({ page: 'trip', params: { ...rangeParams, start } });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Notified after setParams; the browser's own hash navigation fires events. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // hashchange: link clicks and edits in the address bar; popstate: back/forward
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}

// Parsed once per distinct hash, so every reader shares one stable object
let snapshotHash = window.location.hash;
let snapshot = parseHash(snapshotHash);

function getSnapshot(): Route {
  const hash = window.location.hash;
  if (hash !== snapshotHash) {
    snapshotHash = hash;
    snapshot = parseHash(hash);
  }
  return snapshot;
}

/** The current route; re-renders when the hash changes. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Updates params of the current page's URL (null or '' removes a param).
 * `replace` amends the current history entry instead of pushing a new one.
 * Does nothing when the resulting URL is unchanged.
 *
 * Uses the History API rather than assigning `location.hash` so the store
 * updates synchronously, within the event handler that caused the change
 * (controlled inputs, like the custom date fields, rely on that).
 */
export function setParams(
  patch: Readonly<Record<string, string | null>>,
  { replace }: { replace: boolean },
): void {
  const current = getSnapshot();
  const params: Record<string, string> = { ...current.params };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') delete params[key];
    else params[key] = value;
  }

  const next = { page: current.page, params };
  if (routeHref(next) === routeHref(current)) return;
  navigate(next, { replace });
}

/**
 * Goes to another route from code (links are plain <a href>s). `replace`
 * amends the current history entry, e.g. for a redirect, so back doesn't
 * return to a URL that immediately redirects again.
 */
export function navigate(route: Route, { replace }: { replace: boolean }): void {
  const href = routeHref(route);
  if (href === window.location.hash) return;

  if (replace) window.history.replaceState(window.history.state, '', href);
  else window.history.pushState(null, '', href);
  for (const listener of listeners) listener();
}
