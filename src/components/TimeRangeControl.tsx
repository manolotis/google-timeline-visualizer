/**
 * Top-bar picker for the global time range: a compact trigger that opens a
 * panel with presets (All time, Last 12 months, each year in the data) and
 * custom start/end date inputs. Every change applies to all pages at once.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { boundsYears, useTimeRange, type RangeSelection } from '../timeRange';

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-md text-xs border transition-colors whitespace-nowrap ${
        active
          ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
          : 'bg-gray-800 text-gray-300 border-gray-700 hover:text-white hover:border-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

const DATE_INPUT_CLASS =
  'mt-1 w-full bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-200 [color-scheme:dark] focus:outline-none focus:border-orange-500/60';

export default function TimeRangeControl() {
  const { selection, setSelection, range, bounds, label, valid } = useTimeRange();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close the panel on an outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const filtered = selection.kind !== 'all';
  // Compact label for phone-width top bars
  const shortLabel =
    selection.kind === 'all' ? 'All'
    : selection.kind === 'last12' ? '12 mo'
    : selection.kind === 'year' ? String(selection.year)
    : 'Custom';
  const pick = (next: RangeSelection) => {
    setSelection(next);
    setOpen(false);
  };

  // The date inputs show custom values exactly as typed (so partially typed
  // dates don't jump around), otherwise the dates the active preset covers.
  const startValue =
    selection.kind === 'custom' ? selection.start : (range.start ?? bounds?.start ?? '');
  const endValue =
    selection.kind === 'custom' ? selection.end : (range.end ?? bounds?.end ?? '');

  return (
    <div ref={rootRef} className="relative shrink-0 flex items-center gap-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!bounds}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Time range shown on every page: ${label}`}
        className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm border whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          !valid
            ? 'bg-red-500/10 border-red-500/50 text-red-300'
            : filtered
              ? 'bg-orange-500/15 border-orange-500/40 text-orange-300 hover:bg-orange-500/25'
              : 'bg-gray-800/60 border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800'
        }`}
      >
        <span aria-hidden="true">📅</span>
        <span className="md:hidden">{shortLabel}</span>
        <span className="hidden md:inline">{label}</span>
        <span aria-hidden="true" className="hidden sm:inline text-[10px] opacity-60">▼</span>
      </button>
      {filtered && (
        <button
          type="button"
          onClick={() => setSelection({ kind: 'all' })}
          aria-label="Reset time range to all time"
          title="Reset to all time"
          className="hidden sm:block w-7 h-7 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
        >
          ✕
        </button>
      )}

      {open && bounds && (
        <div
          role="dialog"
          aria-label="Time range"
          className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/60 p-4 space-y-4"
        >
          <div className="flex flex-wrap gap-1.5">
            <Chip active={selection.kind === 'all'} onClick={() => pick({ kind: 'all' })}>
              All time
            </Chip>
            <Chip active={selection.kind === 'last12'} onClick={() => pick({ kind: 'last12' })}>
              Last 12 months
            </Chip>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-2">Year</div>
            <div className="grid grid-cols-4 gap-1.5">
              {boundsYears(bounds).map((year) => (
                <Chip
                  key={year}
                  active={selection.kind === 'year' && selection.year === year}
                  onClick={() => pick({ kind: 'year', year })}
                >
                  {year}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-2">Custom range</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-400">
                From
                <input
                  type="date"
                  value={startValue}
                  min={bounds.start}
                  max={bounds.end}
                  onChange={(e) => setSelection({ kind: 'custom', start: e.target.value, end: endValue })}
                  className={DATE_INPUT_CLASS}
                />
              </label>
              <label className="text-xs text-gray-400">
                To
                <input
                  type="date"
                  value={endValue}
                  min={bounds.start}
                  max={bounds.end}
                  onChange={(e) => setSelection({ kind: 'custom', start: startValue, end: e.target.value })}
                  className={DATE_INPUT_CLASS}
                />
              </label>
            </div>
            {!valid && (
              <p className="text-xs text-red-400 mt-2">The start date is after the end date.</p>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-gray-500 border-t border-gray-800 pt-3">
            Applies to every page. Your data covers{' '}
            <span className="whitespace-nowrap">{bounds.start} → {bounds.end}</span>.
          </p>
        </div>
      )}
    </div>
  );
}
