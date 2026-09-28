/**
 * Firsts & Streaks section (bottom of the Statistics page).
 *
 * New countries/cities per year are lifetime facts — the year of a place's
 * first-ever presence/night — computed once from the full dataset and never
 * relative to the selected time range; the range only limits which of those
 * years are displayed (rangeOverlapsYear in aggregate.ts). Streaks are the
 * opposite: computed only from nights inside the selected range, clipped at
 * its edges like every other range-aware aggregation in this app. The
 * "firsts" stat cards (first flight, farthest-ever night, best year for new
 * countries) are all-time records too, for the same reason the per-year
 * lists are all-time.
 *
 * Self-contained: loads its own data (geography, nights, flights), the same
 * way VisitedCountriesMap does, so Statistics.tsx just renders it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useGeography, useNightsAway, useFlights } from '../hooks/useData';
import Loader from './Loader';
import StatCard from './StatCard';
import {
  isStaleGeography,
  newCountriesByYear,
  newCitiesByYear,
  rangeOverlapsYear,
  peakYear,
  longestNightStreak,
  isOwnHomeNight,
  streakCities,
  farthestNightEver,
  firstFlightEver,
  type YearFirsts,
  type Streak,
} from '../aggregate';
import { useTimeRange, type DateRange } from '../timeRange';
import RegenerateHint from './RegenerateHint';

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
      {children}
    </span>
  );
}

const CHIP_PREVIEW = 8;

/** One year's row of chips, collapsed to CHIP_PREVIEW with a "+N more" toggle when long. */
function YearRow({ year, labels }: { year: number; labels: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? labels : labels.slice(0, CHIP_PREVIEW);
  const hidden = labels.length - shown.length;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800/60 last:border-0">
      <div className="w-14 flex-shrink-0 pt-0.5">
        <div className="text-sm font-semibold text-gray-200">{year}</div>
        <div className="text-[11px] text-gray-500">{labels.length} new</div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((label, i) => (
          // Index in the key: two entries can share a display label (e.g. a
          // same-named city resolved from two distinct places).
          <Chip key={`${i}-${label}`}>{label}</Chip>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/30 hover:bg-orange-500/20 transition-colors"
          >
            +{hidden} more
          </button>
        )}
        {expanded && labels.length > CHIP_PREVIEW && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300 transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

function YearFirstsCard<T>({
  title,
  subtitle,
  byYear,
  labelOf,
  range,
  inRangeText,
  emptyText,
}: {
  title: string;
  subtitle: string;
  byYear: YearFirsts<T>[];
  labelOf: (item: T) => string;
  range: DateRange;
  inRangeText: string;
  emptyText: string;
}) {
  const shown = useMemo(
    () => byYear.filter((y) => rangeOverlapsYear(range, y.year)),
    [byYear, range],
  );
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500 mt-4">
          {emptyText}
          {inRangeText}.
        </p>
      ) : (
        <div className="mt-3">
          {shown.map((y) => (
            <YearRow key={y.year} year={y.year} labels={y.items.map(labelOf)} />
          ))}
        </div>
      )}
    </div>
  );
}

function StreakCard({
  title,
  icon,
  streak,
  cities,
  color,
}: {
  title: string;
  icon: string;
  streak: Streak | null;
  cities?: string[];
  color: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="flex items-center gap-2 text-sm text-gray-400">
        <span aria-hidden="true">{icon}</span> {title}
      </h3>
      {streak ? (
        <>
          <p className={`text-2xl font-bold mt-1 ${color}`}>
            {streak.nights.toLocaleString()} night{streak.nights === 1 ? '' : 's'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {streak.start} → {streak.end}
          </p>
          {cities && cities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {/* Index in the key: a streak can revisit a city non-consecutively */}
              {cities.map((c, i) => (
                <Chip key={`${i}-${c}`}>{c}</Chip>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-500 mt-2">No streak in this range.</p>
      )}
    </div>
  );
}

export default function FirstsAndStreaks() {
  const { data: geo, loading: gl, error: geoError } = useGeography();
  const { data: nights, loading: nl } = useNightsAway();
  const { data: flights, loading: fl } = useFlights();
  const { range, selection, label } = useTimeRange();

  const stale = !!geo && isStaleGeography(geo);
  const inRangeText = selection.kind === 'all' ? '' : ` in ${label}`;
  const streakRangeText = selection.kind === 'all' ? 'all time' : label;

  const countriesByYear = useMemo(() => (geo && !stale ? newCountriesByYear(geo) : []), [geo, stale]);
  const citiesByYear = useMemo(() => (geo && !stale ? newCitiesByYear(geo) : []), [geo, stale]);
  const bestCountryYear = useMemo(() => peakYear(countriesByYear), [countriesByYear]);

  const travelStreak = useMemo(
    () => (nights ? longestNightStreak(nights, range, (n) => !n.isHome) : null),
    [nights, range],
  );
  const homeStreak = useMemo(
    // At your own home: a family-home night ends both streaks
    () => (nights ? longestNightStreak(nights, range, isOwnHomeNight) : null),
    [nights, range],
  );
  const hasFamilyNights = useMemo(() => !!nights?.some((n) => n.family), [nights]);
  const travelCities = useMemo(
    () => (geo && !stale && travelStreak ? streakCities(geo, travelStreak) : []),
    [geo, stale, travelStreak],
  );

  const farthestNight = useMemo(() => (nights ? farthestNightEver(nights) : null), [nights]);
  const farthestPlace = useMemo(() => {
    if (!farthestNight || !geo || stale) return null;
    const entry = geo.nights.find((n) => n.date === farthestNight.date);
    if (!entry || entry.city === null) return null;
    const city = geo.cities[entry.city];
    return `${city.city}, ${geo.countries[city.country].country}`;
  }, [farthestNight, geo, stale]);
  const firstFlight = useMemo(() => (flights ? firstFlightEver(flights) : null), [flights]);

  if (gl || nl || fl) return <Loader />;
  if (!geo || !nights || !flights) {
    return (
      <p className="text-sm text-gray-500">
        Firsts &amp; streaks unavailable{geoError ? ` (${geoError})` : ''}.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">🏆 Firsts &amp; Streaks</h2>
        <p className="text-sm text-gray-400 mt-1">
          New countries and cities are lifetime firsts — the year each was first visited, not
          relative to the selected range. Streaks are computed for {streakRangeText}; a night
          without tracked location data ends a streak
          {hasFamilyNights ? ', and so does a night at a family home (neither away nor home)' : ''}.
        </p>
      </div>

      {stale ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-400">
            <RegenerateHint /> to generate the per-date country presence that new countries/cities per
            year needs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <YearFirstsCard
            title="New Countries per Year"
            subtitle="Year of each country's first-ever visit"
            byYear={countriesByYear}
            labelOf={(c) => c.country}
            range={range}
            inRangeText={inRangeText}
            emptyText="No countries were newly visited"
          />
          <YearFirstsCard
            title="New Cities per Year"
            subtitle="Year of each city's first-ever night away"
            byYear={citiesByYear}
            labelOf={(c) => `${c.city}, ${c.country}`}
            range={range}
            inRangeText={inRangeText}
            emptyText="No cities were newly visited"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StreakCard
          title="Longest Travel Streak"
          icon="🧳"
          streak={travelStreak}
          cities={travelCities}
          color="text-orange-400"
        />
        <StreakCard
          title="Longest Home Streak"
          icon="🏠"
          streak={homeStreak}
          color="text-emerald-400"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon="✈️"
          label="First Flight"
          value={firstFlight ? firstFlight.date : 'N/A'}
          sub={
            firstFlight
              ? `${firstFlight.startCity ?? '?'} → ${firstFlight.endCity ?? '?'} · ${firstFlight.distanceKm.toLocaleString()} km`
              : undefined
          }
        />
        <StatCard
          icon="🌍"
          label="Farthest Night from Home"
          value={farthestNight ? `${farthestNight.distKm?.toLocaleString()} km` : 'N/A'}
          sub={farthestNight ? `${farthestNight.date}${farthestPlace ? ` · ${farthestPlace}` : ''}` : undefined}
        />
        <StatCard
          icon="📈"
          label="Most New Countries in a Year"
          value={bestCountryYear ? String(bestCountryYear.year) : 'N/A'}
          sub={
            bestCountryYear
              ? `${bestCountryYear.items.length} new: ${bestCountryYear.items.map((c) => c.country).join(', ')}`
              : undefined
          }
        />
      </div>
    </div>
  );
}
