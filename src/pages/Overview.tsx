/**
 * Overview dashboard page — the landing view of the app.
 *
 * Displays summary stat cards (flights, nights away, places, distance,
 * walking, cycling, flight distance, trips), a visited-countries world map,
 * per-period bar charts for flights and nights away, a transport mode pie
 * chart with distance breakdown, and record highlights (longest trip,
 * furthest trip, each linking to its trip page) — all for the globally
 * selected time range.
 */
import { useMemo } from 'react';
import { useStats, useFlights, useVisits, useNightsAway, useTrips } from '../hooks/useData';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import VisitedCountriesMap from '../components/VisitedCountriesMap';
import { MODE_COLORS, MODE_LABELS, FALLBACK_MODE_COLOR, CHART_TOOLTIP_STYLE } from '../constants';
import {
  summarizeActivities,
  summarizeVisits,
  longestTrip,
  furthestTrip,
  countByPeriod,
  periodSeries,
} from '../aggregate';
import {
  useTimeRange,
  inRange,
  overlapsRange,
  rangePeriods,
  statsBounds,
  periodNoun,
  selectionToParams,
} from '../timeRange';
import { tripHref, type RouteParams } from '../route';
import type { Trip } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

function TripHighlight({
  title,
  value,
  trip,
  rangeParams,
}: {
  title: string;
  value: string;
  trip: Trip;
  rangeParams: RouteParams;
}) {
  return (
    <a
      href={tripHref(trip.startDate, rangeParams)}
      className="group block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-orange-500/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
    >
      <h3 className="flex items-center justify-between text-sm text-gray-400">
        {title}
        <span className="text-xs text-gray-600 group-hover:text-orange-400 transition-colors">
          View trip ›
        </span>
      </h3>
      <p className="text-xl font-bold text-white mt-1">{value}</p>
      <p className="text-sm text-gray-500 mt-1">
        {trip.startDate} → {trip.endDate}
      </p>
    </a>
  );
}

export default function Overview() {
  const { data: stats, loading: sl, error } = useStats();
  const { data: flights, loading: fl } = useFlights();
  const { data: visits, loading: vl } = useVisits();
  const { data: nights, loading: nl } = useNightsAway();
  const { data: trips, loading: tl } = useTrips();
  const { selection, range, label } = useTimeRange();

  const summary = useMemo(() => {
    if (!stats || !flights || !visits || !nights || !trips) return null;
    const periods = rangePeriods(range, statsBounds(stats));
    const flightsInRange = flights.filter((f) => inRange(f.date, range));
    const nightsInRange = nights.filter((n) => inRange(n.date, range));
    const awayDates = nightsInRange.filter((n) => !n.isHome).map((n) => n.date);
    const tripsInRange = trips.filter((t) => overlapsRange(t.startDate, t.endDate, range));
    return {
      periods,
      activity: summarizeActivities(stats, range),
      uniquePlaces: summarizeVisits(visits, range).places.length,
      flightCount: flightsInRange.length,
      nightsTracked: nightsInRange.length,
      nightsAway: awayDates.length,
      tripCount: tripsInRange.length,
      longest: longestTrip(tripsInRange),
      furthest: furthestTrip(tripsInRange),
      flightSeries: periodSeries(periods, countByPeriod(flightsInRange.map((f) => f.date), periods)),
      nightSeries: periodSeries(periods, countByPeriod(awayDates, periods)),
    };
  }, [stats, flights, visits, nights, trips, range]);

  if (sl || fl || vl || nl || tl) return <Loader />;
  if (!stats || !summary) return <EmptyState error={error} />;

  const { activity, periods } = summary;
  const rangeText =
    selection.kind === 'all'
      ? `${stats.dateRange.start.slice(0, 4)}–${stats.dateRange.end.slice(0, 4)}`
      : label;

  const header = (
    <div>
      <h1 className="text-3xl font-bold text-white">Timeline Dashboard</h1>
      <p className="text-gray-400 mt-1">
        {rangeText} · {summary.nightsTracked.toLocaleString()} days tracked
      </p>
    </div>
  );

  if (summary.nightsTracked === 0 && activity.count === 0 && summary.uniquePlaces === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        {header}
        <NoDataInRange />
      </div>
    );
  }

  // Top modes by distance (exclude unknown)
  const modeData = Object.entries(activity.distanceByMode)
    .filter(([k]) => k !== 'UNKNOWN_ACTIVITY_TYPE')
    .sort((a, b) => b[1] - a[1])
    .map(([mode, km]) => ({
      name: MODE_LABELS[mode] || mode,
      km,
      color: MODE_COLORS[mode] || FALLBACK_MODE_COLOR,
    }));

  const laps = Math.round(activity.totalDistanceKm / 40075);
  const earthComparison =
    laps >= 1
      ? `${laps} ${laps === 1 ? 'time' : 'times'} around Earth`
      : `${Math.round((activity.totalDistanceKm / 40075) * 100)}% of the way around Earth`;
  const km = (mode: string) => activity.distanceByMode[mode] ?? 0;
  const hours = (mode: string) => activity.durationByMode[mode] ?? 0;
  const noun = periodNoun(periods);
  const rangeParams = selectionToParams(selection);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {header}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="✈️" label="Flights Taken" value={summary.flightCount} />
        <StatCard
          icon="🌙"
          label="Nights Away"
          value={summary.nightsAway}
          sub={`${summary.nightsTracked ? Math.round((summary.nightsAway / summary.nightsTracked) * 100) : 0}% of tracked nights`}
        />
        <StatCard
          icon="📍"
          label="Unique Places"
          value={summary.uniquePlaces}
        />
        <StatCard
          icon="🗺️"
          label="Total Distance"
          value={`${activity.totalDistanceKm.toLocaleString()} km`}
          sub={earthComparison}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🚶" label="Walking" value={`${km('WALKING').toLocaleString()} km`} sub={`${hours('WALKING').toLocaleString()} hours`} />
        <StatCard icon="🚲" label="Cycling" value={`${km('CYCLING').toLocaleString()} km`} sub={`${hours('CYCLING').toLocaleString()} hours`} />
        <StatCard icon="✈️" label="Flight Distance" value={`${km('FLYING').toLocaleString()} km`} />
        <StatCard icon="🧳" label="Trips" value={summary.tripCount} />
      </div>

      {/* Visited-countries choropleth for the range (loads its own data) */}
      <VisitedCountriesMap />

      {/* Per-period trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Flights per {noun}</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={summary.flightSeries}>
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" name="Flights" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Nights Away per {noun}</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={summary.nightSeries}>
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" name="Nights away" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Transport mode breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Distance by Transport Mode</h2>
          {modeData.length === 0 ? (
            <p className="text-gray-500 text-sm">No movement recorded in this range.</p>
          ) : (
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
                {/* Pie slices carry no series color (fills live on the Cells), so
                    Recharts' tooltip item text falls back to black without this */}
                <Tooltip
                  {...CHART_TOOLTIP_STYLE}
                  itemStyle={{ color: '#f9fafb' }}
                  formatter={(value: number) => `${value.toLocaleString()} km`}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Distance Breakdown</h2>
          {modeData.length === 0 ? (
            <p className="text-gray-500 text-sm">No movement recorded in this range.</p>
          ) : (
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
          )}
        </div>
      </div>

      {/* Records, each linking to its trip's detail page */}
      {summary.longest && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TripHighlight
            title="Longest Trip"
            value={`${summary.longest.nights} nights`}
            trip={summary.longest}
            rangeParams={rangeParams}
          />
          {summary.furthest && (
            <TripHighlight
              title="Furthest Trip"
              value={`${summary.furthest.maxDistKm.toLocaleString()} km from home`}
              trip={summary.furthest}
              rangeParams={rangeParams}
            />
          )}
        </div>
      )}
    </div>
  );
}
