/**
 * Nights Away page — calendar heatmap and trip list.
 *
 * Renders per-year calendar heatmaps showing home/away status for each
 * night, a year selector, and a list of detected trips with their dates,
 * place counts, and distance from home. The home location is auto-detected
 * during preprocessing from INFERRED_HOME / HOME visit entries.
 */
import { useState, useMemo } from 'react';
import { useNightsAway, useTrips, useStats } from '../hooks/useData';
import CalendarHeatmap from '../components/CalendarHeatmap';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';

export default function NightsAway() {
  const { data: nights, loading: nl } = useNightsAway();
  const { data: trips, loading: tl } = useTrips();
  const { data: stats, loading: sl } = useStats();

  const years = useMemo(() => {
    if (!nights) return [];
    const s = new Set(nights.map((n) => parseInt(n.date.slice(0, 4))));
    return [...s].sort((a, b) => b - a);
  }, [nights]);

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const year = selectedYear ?? years[0] ?? 2025;

  const yearNights = useMemo(
    () => nights?.filter((n) => n.date.startsWith(String(year))) ?? [],
    [nights, year],
  );

  const awayThisYear = yearNights.filter((n) => !n.isHome).length;
  const totalDaysYear = yearNights.length;

  // Trips for selected year
  const yearTrips = useMemo(
    () => trips?.filter((t) => t.startDate.startsWith(String(year))) ?? [],
    [trips, year],
  );

  if (nl || tl || sl) return <Loader />;
  if (!nights || !trips || !stats)
    return <div className="p-6 text-gray-400">No data available</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-white">Nights Away from Home</h1>

      {/* Global stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="🌙"
          label="Total Nights Away"
          value={stats.totalNightsAway}
          sub={`${Math.round((stats.totalNightsAway / stats.totalNightsTracked) * 100)}% of all nights`}
        />
        <StatCard icon="🧳" label="Total Trips" value={stats.totalTrips} />
        <StatCard
          icon="📅"
          label="Longest Trip"
          value={stats.longestTrip ? `${stats.longestTrip.nights} nights` : 'N/A'}
          sub={
            stats.longestTrip
              ? `${stats.longestTrip.startDate} → ${stats.longestTrip.endDate}`
              : undefined
          }
        />
        <StatCard
          icon="🌍"
          label="Furthest Trip"
          value={
            stats.furthestTrip
              ? `${stats.furthestTrip.maxDistKm.toLocaleString()} km`
              : 'N/A'
          }
        />
      </div>

      {/* Year selector */}
      <div className="flex gap-2 flex-wrap">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              y === year
                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {/* Calendar heatmap */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{year}</h2>
          <div className="text-sm text-gray-400">
            <span className="text-orange-400 font-semibold">{awayThisYear}</span>{' '}
            nights away out of {totalDaysYear} ({Math.round((awayThisYear / totalDaysYear) * 100) || 0}%)
          </div>
        </div>
        <CalendarHeatmap nights={yearNights} year={year} />
      </div>

      {/* Trips list for year */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">
          Trips in {year} ({yearTrips.length})
        </h2>
        {yearTrips.length === 0 ? (
          <p className="text-gray-500">No trips this year</p>
        ) : (
          <div className="space-y-2">
            {yearTrips
              .sort(
                (a, b) =>
                  new Date(b.startDate).getTime() -
                  new Date(a.startDate).getTime(),
              )
              .map((trip, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3"
                >
                  <div>
                    <div className="text-sm text-gray-200">
                      {trip.startDate} → {trip.endDate}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {trip.places.length} place{trip.places.length !== 1 ? 's' : ''} ·{' '}
                      {trip.maxDistKm.toLocaleString()} km from home
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-orange-400">
                      {trip.nights}
                    </div>
                    <div className="text-xs text-gray-500">nights</div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
