/**
 * Overview dashboard page — the landing view of the app.
 *
 * Displays summary stat cards (flights, nights away, places, distance,
 * walking, cycling, flight distance, trips), yearly bar charts for flights
 * and nights away, a transport mode pie chart with distance breakdown,
 * and record highlights (longest trip, furthest trip).
 */
import { useStats, useFlights, useVisits } from '../hooks/useData';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

const MODE_COLORS: Record<string, string> = {
  FLYING: '#f59e0b',
  WALKING: '#22c55e',
  CYCLING: '#3b82f6',
  IN_VEHICLE: '#a855f7',
  IN_PASSENGER_VEHICLE: '#ec4899',
  IN_TRAIN: '#06b6d4',
  IN_BUS: '#14b8a6',
  IN_SUBWAY: '#8b5cf6',
  IN_TRAM: '#64748b',
  IN_FERRY: '#0ea5e9',
  MOTORCYCLING: '#ef4444',
  RUNNING: '#10b981',
  SAILING: '#0284c7',
  SKIING: '#e2e8f0',
  UNKNOWN_ACTIVITY_TYPE: '#374151',
};

const MODE_LABELS: Record<string, string> = {
  FLYING: 'Flying',
  WALKING: 'Walking',
  CYCLING: 'Cycling',
  IN_VEHICLE: 'Driving',
  IN_PASSENGER_VEHICLE: 'Taxi/Ride',
  IN_TRAIN: 'Train',
  IN_BUS: 'Bus',
  IN_SUBWAY: 'Subway',
  IN_TRAM: 'Tram',
  IN_FERRY: 'Ferry',
  MOTORCYCLING: 'Motorcycle',
  RUNNING: 'Running',
  SAILING: 'Sailing',
  SKIING: 'Skiing',
  UNKNOWN_ACTIVITY_TYPE: 'Unknown',
};

export default function Overview() {
  const { data: stats, loading: sl } = useStats();
  const { data: flights, loading: fl } = useFlights();
  const { data: visits, loading: vl } = useVisits();

  if (sl || fl || vl) return <Loader />;
  if (!stats || !flights || !visits) return <div className="p-6 text-gray-400">No data available</div>;

  const startYear = new Date(stats.dateRange.start).getFullYear();
  const endYear = new Date(stats.dateRange.end).getFullYear();

  // Top modes by distance (exclude unknown)
  const modeData = Object.entries(stats.distanceByMode)
    .filter(([k]) => k !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1])
    .map(([mode, km]) => ({
      name: MODE_LABELS[mode] || mode,
      km,
      color: MODE_COLORS[mode] || '#6b7280',
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

      {/* Yearly trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Yearly Flights</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.yearly}>
              <XAxis dataKey="year" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
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
              <Tooltip
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
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
                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
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
