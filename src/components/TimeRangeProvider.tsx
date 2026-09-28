/**
 * Holds the global time-range selection for every page. Must sit above the
 * page switch in App.tsx: pages unmount on navigation, the range must not.
 * Data bounds (for presets and date-input limits) come from stats.json.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useStats } from '../hooks/useData';
import {
  TimeRangeContext,
  isValidRange,
  selectionLabel,
  selectionRange,
  statsBounds,
  type RangeSelection,
} from '../timeRange';

export default function TimeRangeProvider({ children }: { children: ReactNode }) {
  const { data: stats } = useStats();
  const [selection, setSelection] = useState<RangeSelection>({ kind: 'all' });

  const bounds = useMemo(() => (stats ? statsBounds(stats) : null), [stats]);

  const value = useMemo(() => {
    const range = selectionRange(selection, bounds);
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
