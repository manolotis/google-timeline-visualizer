/**
 * Nights Away page — calendar heatmap and trip list.
 *
 * Renders per-year calendar heatmaps showing home/away status for each
 * night, a year selector (kept in the URL), and a list of detected trips
 * with their dates, place counts, and distance from home, restricted to the
 * globally selected time range; each trip links to its detail page
 * (TripDetail). "Home" is wherever you lived at the time: preprocessing
 * detects home periods (from INFERRED_HOME / HOME visits and where you
 * slept) and measures every night against the home of its period; the
 * header lists the homes that apply to the range. Nights at a configured
 * family home aren't away (nor home): they get their own heatmap color and
 * count, and never belong to a trip.
 */
import { useMemo } from 'react';
import { useNightsAway, useTrips, useHomePeriods } from '../hooks/useData';
import { setParams, tripHref, useRoute } from '../route';
import CalendarHeatmap from '../components/CalendarHeatmap';
import StatCard from '../components/StatCard';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import {
  longestTrip,
  furthestTrip,
  isStaleHome,
  homePeriodsInRange,
  homePeriodYears,
  homePlaceName,
  familyNightLabels,
} from '../aggregate';
import {
  useTimeRange,
  inRange,
  overlapsRange,
  intersectRanges,
  yearRange,
  selectionToParams,
} from '../timeRange';
import RegenerateHint from '../components/RegenerateHint';

export default function NightsAway() {
  const { data: nights, loading: nl, error } = useNightsAway();
  const { data: trips, loading: tl } = useTrips();
  const { data: homeData } = useHomePeriods();
  const { selection, range } = useTimeRange();

  const staleHome = !!homeData && isStaleHome(homeData);
  const rangeHomes = useMemo(
    () => (homeData && !staleHome ? homePeriodsInRange(homeData, range) : []),
    [homeData, staleHome, range],
  );

  const rangeNights = useMemo(
    () => nights?.filter((n) => inRange(n.date, range)) ?? [],
    [nights, range],
  );
  const rangeTrips = useMemo(
    () => trips?.filter((t) => overlapsRange(t.startDate, t.endDate, range)) ?? [],
    [trips, range],
  );
  const rangeFamilyHomes = useMemo(() => familyNightLabels(rangeNights), [rangeNights]);
  const familyHomesNoun = rangeFamilyHomes.length > 1 ? 'family homes' : 'family home';

  // Years with tracked nights inside the range, newest first
  const years = useMemo(() => {
    const s = new Set(rangeNights.map((n) => parseInt(n.date.slice(0, 4))));
    return [...s].sort((a, b) => b - a);
  }, [rangeNights]);

  // The picked year is kept in the URL (`year=2023`, absent for the default,
  // the newest year) and only applies while it is inside the global range
  const { params } = useRoute();
  const pickedYear = /^\d{4}$/.test(params.year ?? '') ? Number(params.year) : null;
  const year = pickedYear !== null && years.includes(pickedYear) ? pickedYear : years[0];
  const pickYear = (y: number) =>
    setParams({ year: y === years[0] ? null : String(y) }, { replace: true });

  // The part of the global range that falls inside the displayed year
  const yearWindow = useMemo(
    () => (year === undefined ? range : intersectRanges(range, yearRange(year))),
    [range, year],
  );

  const yearNights = useMemo(
    () => rangeNights.filter((n) => inRange(n.date, yearWindow)),
    [rangeNights, yearWindow],
  );

  const yearTrips = useMemo(
    () =>
      rangeTrips
        .filter((t) => overlapsRange(t.startDate, t.endDate, yearWindow))
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [rangeTrips, yearWindow],
  );

  if (nl || tl) return <Loader />;
  if (!nights || !trips) return <EmptyState error={error} />;

  const header = (
    <div>
      <h1 className="text-3xl font-bold text-white">Nights Away from Home</h1>
      {staleHome ? (
        <p className="text-sm text-gray-400 mt-1">
          <RegenerateHint /> to detect where you lived over time.
        </p>
      ) : rangeHomes.length > 0 && (
        <p className="text-gray-400 mt-1" title="Each night is measured from the home you lived in at the time">
          🏠{' '}
          {rangeHomes.map((h, i) => (
            <span key={h.start}>
              {i > 0 && ' → '}
              <span className="text-gray-200">{homePlaceName(h)}</span> ({homePeriodYears(h)})
            </span>
          ))}
        </p>
      )}
      {rangeFamilyHomes.length > 0 && (
        <p className="text-gray-400 mt-1" title="Configured in timeline-config.json">
          🏡 {rangeFamilyHomes.length > 1 ? 'Family homes' : 'Family home'}:{' '}
          <span className="text-gray-200">{rangeFamilyHomes.join(', ')}</span>
          <span className="text-gray-500"> · nights there don't count as away</span>
        </p>
      )}
    </div>
  );
  if (year === undefined) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {header}
        <NoDataInRange title="No tracked nights in this range" />
      </div>
    );
  }

  const awayTotal = rangeNights.filter((n) => !n.isHome).length;
  const awayThisYear = yearNights.filter((n) => !n.isHome).length;
  const familyTotal = rangeNights.filter((n) => n.family).length;
  const familyThisYear = yearNights.filter((n) => n.family).length;
  const totalDaysYear = yearNights.length;
  const longest = longestTrip(rangeTrips);
  const furthest = furthestTrip(rangeTrips);
  const rangeParams = selectionToParams(selection);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {header}

      {/* Stats for the selected range */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="🌙"
          label="Total Nights Away"
          value={awayTotal}
          sub={
            `${Math.round((awayTotal / rangeNights.length) * 100)}% of all nights` +
            (familyTotal > 0 ? ` · ${familyTotal.toLocaleString()} at ${familyHomesNoun}` : '')
          }
        />
        <StatCard icon="🧳" label="Total Trips" value={rangeTrips.length} />
        <StatCard
          icon="📅"
          label="Longest Trip"
          value={longest ? `${longest.nights} nights` : 'N/A'}
          sub={longest ? `${longest.startDate} → ${longest.endDate}` : undefined}
        />
        <StatCard
          icon="🌍"
          label="Furthest Trip"
          value={furthest ? `${furthest.maxDistKm.toLocaleString()} km` : 'N/A'}
        />
      </div>

      {/* Year selector (only years inside the selected range) */}
      {years.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {years.map((y) => (
            <button
              key={y}
              onClick={() => pickYear(y)}
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
      )}

      {/* Calendar heatmap */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{year}</h2>
          <div className="text-sm text-gray-400">
            <span className="text-orange-400 font-semibold">{awayThisYear}</span>{' '}
            nights away out of {totalDaysYear} ({Math.round((awayThisYear / totalDaysYear) * 100) || 0}%)
            {familyThisYear > 0 && (
              <>
                {' · '}
                <span className="text-teal-400 font-semibold">{familyThisYear}</span>{' '}
                at {familyHomesNoun}
              </>
            )}
          </div>
        </div>
        <CalendarHeatmap nights={yearNights} year={year} range={range} />
      </div>

      {/* Trips list for year */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">
          Trips in {year} ({yearTrips.length})
        </h2>
        {yearTrips.length === 0 ? (
          <p className="text-gray-500">No trips in this period</p>
        ) : (
          <div className="space-y-2">
            {yearTrips.map((trip) => (
              <a
                key={trip.startDate}
                href={tripHref(trip.startDate, rangeParams)}
                className="group flex items-center justify-between gap-3 bg-gray-800/50 rounded-lg px-4 py-3 border border-transparent hover:bg-gray-800 hover:border-orange-500/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
              >
                <div>
                  <div className="text-sm text-gray-200 group-hover:text-white">
                    {trip.startDate} → {trip.endDate}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {trip.places.length} place{trip.places.length !== 1 ? 's' : ''} ·{' '}
                    {trip.maxDistKm.toLocaleString()} km from home
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-lg font-bold text-orange-400">
                      {trip.nights}
                    </div>
                    <div className="text-xs text-gray-500">nights</div>
                  </div>
                  <span aria-hidden="true" className="text-gray-600 group-hover:text-orange-400 transition-colors">›</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
