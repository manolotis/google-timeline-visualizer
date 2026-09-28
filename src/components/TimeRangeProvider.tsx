/**
 * Provides the global time-range selection to every page. Must sit above the
 * page switch in App.tsx: pages unmount on navigation, the range must not.
 * Data bounds (for presets and date-input limits) come from stats.json.
 *
 * The selection lives in the URL hash (route.ts) as `range`/`from`/`to`
 * params, so it survives reloads and travels with bookmarks and shared links.
 * It is derived from the URL on every render rather than mirrored into state;
 * setSelection writes the URL, pushing a history entry so back/forward steps
 * through range changes.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useStats } from '../hooks/useData';
import { setParams, useRoute } from '../route';
import {
  CLEARED_RANGE_PARAMS,
  TimeRangeContext,
  isValidRange,
  sameRangeParams,
  selectionFromParams,
  selectionLabel,
  selectionRange,
  selectionToParams,
  statsBounds,
  type RangeSelection,
} from '../timeRange';

export default function TimeRangeProvider({ children }: { children: ReactNode }) {
  const { data: stats } = useStats();
  const { params } = useRoute();

  const bounds = useMemo(() => (stats ? statsBounds(stats) : null), [stats]);

  // Depends on the range params only, so page-local params (e.g. the
  // Flights sort order) don't change the range's identity and re-run every
  // page's range-dependent aggregation
  const urlSelection = useMemo(
    () => selectionFromParams({ range: params.range, from: params.from, to: params.to }),
    [params.range, params.from, params.to],
  );

  // The last selection picked in this tab, used while it still matches the
  // URL. Only matters for a custom range with both dates cleared: the URL
  // can't tell it from All time, and without this the date inputs would
  // snap to the data bounds in the middle of an edit.
  const [picked, setPicked] = useState<RangeSelection | null>(null);
  const selection = picked && sameRangeParams(picked, urlSelection) ? picked : urlSelection;

  const value = useMemo(() => {
    const range = selectionRange(selection, bounds);
    const setSelection = (next: RangeSelection) => {
      setPicked(next);
      setParams(
        { ...CLEARED_RANGE_PARAMS, ...selectionToParams(next) },
        // Every keystroke in the custom date inputs amends one history entry
        { replace: selection.kind === 'custom' && next.kind === 'custom' },
      );
    };
    return {
      selection,
      setSelection,
      range,
      bounds,
      label: selectionLabel(selection, range),
      valid: isValidRange(range),
    };
  }, [selection, bounds]);

  return <TimeRangeContext.Provider value={value}>{children}</TimeRangeContext.Provider>;
}
