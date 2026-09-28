/**
 * GitHub-style calendar heatmap component.
 *
 * Renders a grid of 52–53 weekly columns × 7 day rows for a given year.
 * Each cell is colored based on whether the user was home (dark) or away
 * (orange gradient by distance from home). Includes month labels, day
 * labels, and a color legend.
 */
import { useMemo } from 'react';
import type { NightEntry } from '../types';

interface Props {
  nights: NightEntry[];
  year: number;
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

export default function CalendarHeatmap({ nights, year }: Props) {
  const grid = useMemo(() => {
    const map = new Map(nights.map(n => [n.date, n]));
    // Build weeks for the year
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    // Adjust start to Sunday
    const startDay = start.getDay();
    const gridStart = new Date(start);
    gridStart.setDate(gridStart.getDate() - startDay);

    const weeks: (NightEntry | null)[][] = [];
    let week: (NightEntry | null)[] = [];
    const cur = new Date(gridStart);

    while (cur <= end || week.length > 0) {
      const key = cur.toISOString().slice(0, 10);
      const inRange = cur >= start && cur <= end;
      week.push(inRange ? (map.get(key) ?? { date: key, isHome: true }) : null);

      if (week.length === 7) {
        weeks.push(week);
        week = [];
        if (cur > end) break;
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (week.length > 0) weeks.push(week);
    return weeks;
  }, [nights, year]);

  // Month label positions
  const monthPositions = useMemo(() => {
    const positions: { label: string; col: number }[] = [];
    let lastMonth = -1;
    grid.forEach((week, wi) => {
      for (const day of week) {
        if (day) {
          const m = new Date(day.date).getMonth();
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
              {week.map((day, di) => (
                <div
                  key={di}
                  className="cal-cell"
                  title={day ? `${day.date}: ${day.isHome ? 'Home' : `Away (${day.distKm ?? '?'} km)`}` : ''}
                  style={{
                    backgroundColor: !day
                      ? 'transparent'
                      : day.isHome
                        ? '#1a1a2e'
                        : day.distKm && day.distKm > 1000
                          ? '#f97316'
                          : day.distKm && day.distKm > 100
                            ? '#fb923c'
                            : '#fdba74',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 ml-8 text-gray-500">
          <span>Home</span>
          <div className="cal-cell" style={{ backgroundColor: '#1a1a2e' }} />
          <div className="cal-cell" style={{ backgroundColor: '#fdba74' }} />
          <div className="cal-cell" style={{ backgroundColor: '#fb923c' }} />
          <div className="cal-cell" style={{ backgroundColor: '#f97316' }} />
          <span>Far away</span>
        </div>
      </div>
    </div>
  );
}
