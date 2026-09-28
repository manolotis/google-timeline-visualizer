/**
 * GitHub-style calendar heatmap component.
 *
 * Renders a grid of 52–53 weekly columns × 7 day rows for a given year.
 * Each cell is colored based on whether the user was home (dark), at a
 * family home (teal), or away (orange gradient by distance from home). Days
 * outside the optional `range` are drawn as faint outlines. Includes month
 * labels, day labels, and a color legend.
 */
import { useMemo } from 'react';
import type { NightEntry } from '../types';
import { addDays, dayOfWeek, inRange, type DateRange } from '../timeRange';
import { AWAY_NIGHT_COLORS, FAMILY_NIGHT_COLOR, HOME_NIGHT_COLOR, nightColor } from '../constants';

interface Props {
  nights: NightEntry[];
  year: number;
  /** Days outside this range are shown as excluded */
  range?: DateRange;
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const OPEN_RANGE: DateRange = { start: null, end: null };
const EXCLUDED_STYLE = { backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 1px #1f2937' };

function nightTitle(night: NightEntry): string {
  if (night.family) return `${night.date}: Family home, ${night.family}`;
  if (night.isHome) return `${night.date}: Home`;
  return `${night.date}: Away (${night.distKm ?? '?'} km)`;
}

export default function CalendarHeatmap({ nights, year, range = OPEN_RANGE }: Props) {
  const grid = useMemo(() => {
    const map = new Map(nights.map(n => [n.date, n]));
    // Weeks (Sunday first) covering the year. Cells are keyed by calendar
    // date strings built with pure date arithmetic, so the grid holds exactly
    // the year's night keys whatever the browser's time zone
    const first = `${year}-01-01`;
    const last = `${year}-12-31`;
    const weeks: (NightEntry | null)[][] = [];
    let week: (NightEntry | null)[] = [];
    for (let date = addDays(first, -dayOfWeek(first)); ; date = addDays(date, 1)) {
      const inYear = date >= first && date <= last;
      week.push(inYear ? (map.get(date) ?? { date, isHome: true }) : null);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
        if (date >= last) break;
      }
    }
    return weeks;
  }, [nights, year]);

  const hasExcluded = useMemo(
    () => grid.some((week) => week.some((day) => day !== null && !inRange(day.date, range))),
    [grid, range],
  );
  const hasFamily = useMemo(
    () => grid.some((week) => week.some((day) => day?.family && inRange(day.date, range))),
    [grid, range],
  );

  // Month label positions
  const monthPositions = useMemo(() => {
    const positions: { label: string; col: number }[] = [];
    let lastMonth = -1;
    grid.forEach((week, wi) => {
      for (const day of week) {
        if (day) {
          const m = parseInt(day.date.slice(5, 7), 10) - 1;
          if (m !== lastMonth) {
            positions.push({ label: MONTH_LABELS[m], col: wi });
            lastMonth = m;
          }
          break;
        }
      }
    });
    return positions;
  }, [grid]);

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-0.5 text-xs">
        {/* Month labels */}
        <div className="flex ml-8 mb-1" style={{ gap: '0px' }}>
          {monthPositions.map((mp, i) => (
            <div
              key={i}
              className="text-gray-500 absolute"
              style={{ marginLeft: mp.col * 15 }}
            >
              {mp.label}
            </div>
          ))}
        </div>
        <div className="flex gap-0.5 relative" style={{ marginTop: '18px' }}>
          {/* Day labels */}
          <div className="flex flex-col gap-0.5 mr-1">
            {DAY_LABELS.map((l, i) => (
              <div key={i} className="h-[13px] text-gray-500 text-[10px] leading-[13px] w-6 text-right pr-1">
                {l}
              </div>
            ))}
          </div>
          {/* Grid */}
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {week.map((day, di) =>
                day && !inRange(day.date, range) ? (
                  <div
                    key={di}
                    className="cal-cell"
                    title={`${day.date}: outside the selected range`}
                    style={EXCLUDED_STYLE}
                  />
                ) : (
                  <div
                    key={di}
                    className="cal-cell"
                    title={day ? nightTitle(day) : ''}
                    style={{ backgroundColor: day ? nightColor(day) : 'transparent' }}
                  />
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 ml-8 text-gray-500">
          <span>Home</span>
          {[HOME_NIGHT_COLOR, ...AWAY_NIGHT_COLORS].map((color) => (
            <div key={color} className="cal-cell" style={{ backgroundColor: color }} />
          ))}
          <span>Far away</span>
          {hasFamily && (
            <>
              <div className="cal-cell ml-3" style={{ backgroundColor: FAMILY_NIGHT_COLOR }} />
              <span>Family home</span>
            </>
          )}
          {hasExcluded && (
            <>
              <div className="cal-cell ml-3" style={EXCLUDED_STYLE} />
              <span>Outside range</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
