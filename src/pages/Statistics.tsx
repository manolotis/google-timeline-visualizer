/**
 * Statistics page — detailed analytics and pattern visualizations for the
 * globally selected time range.
 *
 * Includes: distance by transport mode (horizontal bar chart), activity
 * count by mode, distance trend and unique places per year (or per month
 * for short ranges), day-of-week activity radar, hour-of-day histogram, a
 * top-20 most visited places table, and a Firsts & Streaks section (new
 * countries/cities per year, longest travel/home streaks, notable firsts).
 */
import { useMemo } from 'react';
import { useStats, useVisits } from '../hooks/useData';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import FirstsAndStreaks from '../components/FirstsAndStreaks';
import { MODE_COLORS, MODE_LABELS, FALLBACK_MODE_COLOR, CHART_TOOLTIP_STYLE } from '../constants';
import { summarizeActivities, summarizeVisits, periodSeries, isHomePlace } from '../aggregate';
import { useTimeRange, rangePeriods, statsBounds, periodNoun } from '../timeRange';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const tooltipStyle = CHART_TOOLTIP_STYLE;

export default function Statistics() {
  const { data: stats, loading, error } = useStats();
  const { data: visits, loading: vl } = useVisits();
  const { range } = useTimeRange();

  const summary = useMemo(() => {
    if (!stats || !visits) return null;
    const periods = rangePeriods(range, statsBounds(stats));
    const places = summarizeVisits(visits, range, periods);
    return {
      periods,
      activity: summarizeActivities(stats, range, periods),
      placesByPeriod: places.placesByPeriod,
      topPlaces: places.places.filter((p) => !isHomePlace(p.semanticType)).slice(0, 20),
      placeCount: places.places.length,
    };
  }, [stats, visits, range]);

  if (loading || vl) return <Loader />;
  if (!summary) return <EmptyState error={error} />;

  const header = <h1 className="text-3xl font-bold text-white">Statistics</h1>;
  const { activity, periods } = summary;
  if (activity.count === 0 && summary.placeCount === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        {header}
        <NoDataInRange />
        {/* Self-contained: loads its own data, so it can still have something
            to show (e.g. all-time new countries/cities) even when the mode
            and place stats above are empty for this range. */}
        <FirstsAndStreaks />
      </div>
    );
  }

  // Mode bar chart data
  const modeBarData = Object.entries(activity.distanceByMode)
    .filter(([k]) => k !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1])
    .map(([mode, km]) => ({
      mode: MODE_LABELS[mode] || mode,
      km,
      fill: MODE_COLORS[mode] || FALLBACK_MODE_COLOR,
    }));

  // Duration by mode chart data
  const durationBarData = Object.entries(activity.durationByMode)
    .filter(([k]) => k !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1])
    .map(([mode, hours]) => ({
      mode: MODE_LABELS[mode] || mode,
      hours,
      fill: MODE_COLORS[mode] || FALLBACK_MODE_COLOR,
    }));

  // Activity count by mode
  const countData = Object.entries(activity.countByMode)
    .filter(([k]) => k !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1])
    .map(([mode, count]) => ({
      mode: MODE_LABELS[mode] || mode,
      count,
      fill: MODE_COLORS[mode] || FALLBACK_MODE_COLOR,
    }));

  // Day of week radar
  const dowData = activity.dayOfWeek.map((count, i) => ({
    day: DAY_NAMES[i],
    activities: count,
  }));

  // Hour of day
  const hodData = activity.hourOfDay.map((count, i) => ({
    hour: `${i}:00`,
    activities: count,
  }));

  // Per-period distance and unique places
  const distanceSeries = periodSeries(periods, activity.distanceByPeriod, Math.round);
  const placesSeries = periodSeries(periods, summary.placesByPeriod);
  const noun = periodNoun(periods);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {header}

      {/* Distance by mode */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Distance by Transport Mode (km)
          </h2>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={modeBarData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis dataKey="mode" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={90} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number) => `${value.toLocaleString()} km`}
              />
              <Bar dataKey="km" radius={[0, 4, 4, 0]}>
                {modeBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Time Spent by Transport Mode (hours)
          </h2>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={durationBarData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis dataKey="mode" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={90} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number) => `${value.toLocaleString()} h`}
              />
              <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                {durationBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity count by mode */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Activity Count by Mode
          </h2>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={countData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis dataKey="mode" type="category" tick={{ fill: '#9ca3af', fontSize: 11 }} width={90} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]}>
                {countData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-period trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Distance Traveled per {noun}
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={distanceSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number) => `${value.toLocaleString()} km`}
              />
              <Line type="monotone" dataKey="value" name="Distance" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Unique Places Visited per {noun}
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={placesSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="value" name="Places" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity patterns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Activity by Day of Week
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={dowData}>
              <PolarGrid stroke="#374151" />
              <PolarAngleAxis dataKey="day" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <PolarRadiusAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
              <Radar
                dataKey="activities"
                stroke="#f59e0b"
                fill="#f59e0b"
                fillOpacity={0.2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">
            Activity by Hour of Day
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hodData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="hour"
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                interval={2}
              />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="activities" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Places */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">
          Top 20 Most Visited Places (excluding home)
        </h2>
        {summary.topPlaces.length === 0 ? (
          <p className="text-gray-500 text-sm">No places visited in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Place</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Visits</th>
                  <th className="px-3 py-2">Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {summary.topPlaces.map((p, i) => (
                  <tr
                    key={p.placeId}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      {p.city ? (
                        <>
                          <span className="text-gray-200">
                            {p.city}{p.country ? `, ${p.country}` : ''}
                          </span>
                          <span className="block text-[10px] text-gray-500 font-mono">
                            {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400 font-mono text-xs">
                          {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        p.semanticType === 'INFERRED_WORK' || p.semanticType === 'WORK'
                          ? 'bg-blue-500/20 text-blue-400'
                          : p.semanticType === 'SEARCHED_ADDRESS'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-gray-700 text-gray-400'
                      }`}>
                        {p.semanticType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-200 font-semibold">{p.visitCount}</td>
                    <td className="px-3 py-2 text-gray-400">{p.totalHours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Firsts & Streaks (self-contained: loads its own data) */}
      <FirstsAndStreaks />
    </div>
  );
}
