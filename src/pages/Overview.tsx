/**
 * Overview dashboard page — the landing view of the app.
 *
 * Displays summary stat cards (flights, nights away, places, distance,
 * walking, cycling, flight distance, trips), a visited-countries world map,
 * yearly bar charts for flights and nights away, a transport mode pie chart
 * with distance breakdown, and record highlights (longest trip, furthest trip).
 */
import { useStats, useFlights, useVisits } from '../hooks/useData';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import VisitedCountriesMap from '../components/VisitedCountriesMap';
import { MODE_COLORS, MODE_LABELS, FALLBACK_MODE_COLOR, CHART_TOOLTIP_STYLE } from '../constants';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

export default function Overview() {
  const { data: stats, loading: sl, error } = useStats();
  const { data: flights, loading: fl } = useFlights();
  const { data: visits, loading: vl } = useVisits();

  if (sl || fl || vl) return <Loader />;
  if (!stats || !flights || !visits) return <EmptyState error={error} />;

  const startYear = new Date(stats.dateRange.start).getFullYear();
  const endYear = new Date(stats.dateRange.end).getFullYear();

  // Top modes by distance (exclude unknown)
  const modeData = Object.entries(stats.distanceByMode)
    .filter(([k]) => k !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1])
    .map(([mode, km]) => ({
      name: MODE_LABELS[mode] || mode,
      km,
      color: MODE_COLORS[mode] || FALLBACK_MODE_COLOR,
    }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Timeline Dashboard</h1>
        <p className="text-gray-400 mt-1">
          {startYear}–{endYear} · {stats.totalNightsTracked.toLocaleString()} days tracked
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="✈️" label="Flights Taken" value={stats.totalFlights} />
        <StatCard
          icon="🌙"
          label="Nights Away"
          value={stats.totalNightsAway}
          sub={`${Math.round((stats.totalNightsAway / stats.totalNightsTracked) * 100)}% of tracked nights`}
        />
        <StatCard
          icon="📍"
          label="Unique Places"
          value={stats.totalUniqueVisitedPlaces}
        />
        <StatCard
          icon="🗺️"
          label="Total Distance"
          value={`${stats.totalDistanceKm.toLocaleString()} km`}
          sub={`${Math.round(stats.totalDistanceKm / 40075)} times around Earth`}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🚶" label="Walking" value={`${stats.totalWalkingKm.toLocaleString()} km`} sub={`${stats.totalWalkingHours?.toLocaleString() ?? '—'} hours`} />
        <StatCard icon="🚲" label="Cycling" value={`${stats.totalCyclingKm.toLocaleString()} km`} sub={`${stats.totalCyclingHours?.toLocaleString() ?? '—'} hours`} />
        <StatCard icon="✈️" label="Flight Distance" value={`${stats.totalFlightDistanceKm.toLocaleString()} km`} />
        <StatCard icon="🧳" label="Trips" value={stats.totalTrips} />
      </div>

      {/* Visited-countries choropleth (loads its own data) */}
      <VisitedCountriesMap />

      {/* Yearly trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Yearly Flights</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.yearly}>
              <XAxis dataKey="year" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="flights" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Nights Away / Year</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.yearly}>
              <XAxis dataKey="year" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="nightsAway" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Transport mode breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Distance by Transport Mode</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={modeData.slice(0, 8)}
                dataKey="km"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
              >
                {modeData.slice(0, 8).map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                {...CHART_TOOLTIP_STYLE}
                formatter={(value: number) => `${value.toLocaleString()} km`}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Distance Breakdown</h2>
          <div className="space-y-3">
            {modeData.map((m) => (
              <div key={m.name} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                <div className="flex-1 text-sm text-gray-300">{m.name}</div>
                <div className="text-sm font-mono text-gray-400">
                  {m.km.toLocaleString()} km
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Records */}
      {stats.longestTrip && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm text-gray-400">Longest Trip</h3>
            <p className="text-xl font-bold text-white mt-1">
              {stats.longestTrip.nights} nights
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {stats.longestTrip.startDate} → {stats.longestTrip.endDate}
            </p>
          </div>
          {stats.furthestTrip && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-sm text-gray-400">Furthest Trip</h3>
              <p className="text-xl font-bold text-white mt-1">
                {stats.furthestTrip.maxDistKm.toLocaleString()} km from home
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {stats.furthestTrip.startDate} → {stats.furthestTrip.endDate}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
