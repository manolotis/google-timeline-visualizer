/**
 * Compare page — `#/compare?a=2024&b=2025`, two calendar years side by side.
 *
 * Unlike every other page, this one does not filter by the global time range
 * (see the note rendered under the header, the same pattern TripDetail uses):
 * it always compares two *whole* calendar years, chosen independently of
 * whatever range is active elsewhere. That choice lives in its own URL
 * params, `a` and `b` (year A / year B), following the Flights sort-order
 * convention — page-local state, written only when it differs from the
 * default, updated with `{ replace: true }` so picking a year doesn't pile
 * up history entries.
 *
 * Year A is orange, Year B is sky-blue, consistently across every stat row
 * and chart on the page (the color always means "which year", never a
 * transport mode, unlike the mode-colored charts elsewhere in the app).
 */
import { useMemo, type ReactNode } from 'react';
import {
  useStats,
  useFlights,
  useNightsAway,
  useTrips,
  useVisits,
  useGeography,
} from '../hooks/useData';
import { setParams, useRoute } from '../route';
import { useTimeRange, yearRange, boundsYears, statsBounds, inRange, overlapsRange } from '../timeRange';
import {
  summarizeActivities,
  summarizeVisits,
  summarizeGeography,
  isStaleGeography,
  newCountriesByYear,
  newCitiesByYear,
  alignMonths,
  monthlyAwayNights,
  compareByMode,
} from '../aggregate';
import { MODE_LABELS, CHART_TOOLTIP_STYLE } from '../constants';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';
import RegenerateHint from '../components/RegenerateHint';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

/** Year A is always orange, Year B always sky-blue — the app's accent color
 * plus a cool contrast, distinct from every MODE_COLORS hue so a reader
 * never confuses "which year" with "which transport mode". */
const COLOR_A = '#f59e0b';
const COLOR_B = '#38bdf8';
const tooltipStyle = CHART_TOOLTIP_STYLE;

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function YearPicker({
  label,
  color,
  value,
  years,
  onChange,
}: {
  label: string;
  color: string;
  value: number;
  years: number[];
  onChange: (year: number) => void;
}) {
  // The current value might not be one of the data's years (e.g. a hand-typed
  // URL); include it anyway so the <select> always has a matching option.
  const options = years.includes(value) ? years : [value, ...years].sort((a, b) => b - a);
  return (
    <label className="flex items-center gap-2 text-sm text-gray-300">
      <Swatch color={color} />
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-orange-500/60"
      >
        {options.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Delta badge: an up/down arrow plus a magnitude, never color alone (the
 * arrow glyph and the sign carry the direction too). `points` shows the raw
 * difference (for a value that's already a percentage, e.g. "away nights
 * this year"); otherwise it's a relative percent change, or "+N" when the
 * earlier year was zero (a percent change from zero is undefined).
 */
function Delta({
  a,
  b,
  points = false,
  format = (v: number) => v.toLocaleString(),
}: {
  a: number;
  b: number;
  points?: boolean;
  format?: (v: number) => string;
}) {
  const diff = b - a;
  if (Math.round(diff * 10) === 0) return <span className="text-xs text-gray-500">–</span>;
  const up = diff > 0;
  const color = up
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : 'text-red-400 bg-red-500/10 border-red-500/30';
  const text = points
    ? `${up ? '+' : ''}${diff.toFixed(1)} pts`
    : a === 0
      ? `+${format(b)}`
      : `${up ? '+' : ''}${Math.round((diff / a) * 100)}%`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border whitespace-nowrap ${color}`}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {text}
    </span>
  );
}

/**
 * One metric, two years, a delta. Stacks on narrow screens: the label takes
 * its own row, then the two values and the delta share a row of three — so
 * even at 390px nothing scrolls sideways. From `sm` up it's a single row of
 * four columns (label, A, B, delta).
 */
function StatRow({
  label,
  a,
  b,
  format = (v: number) => v.toLocaleString(),
  points = false,
}: {
  label: string;
  a: number;
  b: number;
  format?: (v: number) => string;
  points?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem] items-center gap-x-2 gap-y-1 py-2.5 border-b border-gray-800/60 last:border-0">
      <div className="col-span-3 sm:col-span-1 text-sm text-gray-300">{label}</div>
      <div className="text-sm text-gray-100 font-semibold tabular-nums">{format(a)}</div>
      <div className="text-sm text-gray-100 font-semibold tabular-nums">{format(b)}</div>
      <div>
        <Delta a={a} b={b} points={points} format={format} />
      </div>
    </div>
  );
}

function StatHeader({ yearA, yearB }: { yearA: number; yearB: number }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem] gap-x-2 pb-2 mb-1 border-b border-gray-700 text-xs uppercase tracking-wide text-gray-500">
      <div className="hidden sm:block">Metric</div>
      <div className="flex items-center gap-1.5">
        <Swatch color={COLOR_A} />
        {yearA}
      </div>
      <div className="flex items-center gap-1.5">
        <Swatch color={COLOR_B} />
        {yearB}
      </div>
      <div>Δ</div>
    </div>
  );
}

function StatSection({
  title,
  yearA,
  yearB,
  children,
}: {
  title: string;
  yearA: number;
  yearB: number;
  children: ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <StatHeader yearA={yearA} yearB={yearB} />
      {children}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const KM = (v: number) => `${v.toLocaleString()} km`;
const COUNT = (v: number) => v.toLocaleString();

export default function Compare() {
  const { data: stats, loading: sl, error } = useStats();
  const { data: flights, loading: fl } = useFlights();
  const { data: nights, loading: nl } = useNightsAway();
  const { data: trips, loading: tl } = useTrips();
  const { data: visits, loading: vl } = useVisits();
  const { data: geo, loading: gl } = useGeography();
  const { range, label } = useTimeRange();
  const { params } = useRoute();

  // Years present in the data, and the two most recent *full* years (fully
  // covered by the data's date range) — the default comparison.
  const bounds = useMemo(() => (stats ? statsBounds(stats) : null), [stats]);
  const years = useMemo(() => (bounds ? boundsYears(bounds) : []), [bounds]);
  const fullYears = useMemo(
    () =>
      bounds
        ? years.filter((y) => bounds.start <= `${y}-01-01` && bounds.end >= `${y}-12-31`)
        : [],
    [years, bounds],
  );
  const thisYear = new Date().getFullYear();
  const defaultB = fullYears[0] ?? years[0] ?? thisYear;
  const defaultA = fullYears[1] ?? years[1] ?? defaultB;

  // `a`/`b` in the URL; an unreadable or missing value falls back to the
  // default for that side rather than crashing.
  const parsedA = /^\d{4}$/.test(params.a ?? '') ? Number(params.a) : null;
  const parsedB = /^\d{4}$/.test(params.b ?? '') ? Number(params.b) : null;
  const yearA = parsedA ?? defaultA;
  const yearB = parsedB ?? defaultB;

  const pickYear = (side: 'a' | 'b', year: number) => {
    const def = side === 'a' ? defaultA : defaultB;
    setParams({ [side]: year === def ? null : String(year) }, { replace: true });
  };
  const swap = () => {
    setParams(
      { a: yearB === defaultA ? null : String(yearB), b: yearA === defaultB ? null : String(yearA) },
      { replace: true },
    );
  };

  const comparison = useMemo(() => {
    if (!stats || !flights || !nights || !trips || !visits) return null;

    const rangeA = yearRange(yearA);
    const rangeB = yearRange(yearB);
    // granularity is all summarizeActivities needs to fill distanceByPeriod;
    // the keys themselves are only used for zero-filling a single-range
    // chart (periodSeries), which alignMonths does its own way below.
    const monthPeriods = { granularity: 'month' as const, keys: [] as string[] };

    const activityA = summarizeActivities(stats, rangeA, monthPeriods);
    const activityB = summarizeActivities(stats, rangeB, monthPeriods);

    const flightsA = flights.filter((f) => inRange(f.date, rangeA));
    const flightsB = flights.filter((f) => inRange(f.date, rangeB));

    const nightsA = nights.filter((n) => inRange(n.date, rangeA));
    const nightsB = nights.filter((n) => inRange(n.date, rangeB));
    const awayA = nightsA.filter((n) => !n.isHome).length;
    const awayB = nightsB.filter((n) => !n.isHome).length;

    const tripsA = trips.filter((t) => overlapsRange(t.startDate, t.endDate, rangeA)).length;
    const tripsB = trips.filter((t) => overlapsRange(t.startDate, t.endDate, rangeB)).length;

    const placesA = summarizeVisits(visits, rangeA).places.length;
    const placesB = summarizeVisits(visits, rangeB).places.length;

    const geoStale = !!geo && isStaleGeography(geo);
    const geoOk = geo && !geoStale;
    const geoA = geoOk ? summarizeGeography(geo, rangeA) : null;
    const geoB = geoOk ? summarizeGeography(geo, rangeB) : null;
    const countriesByYear = geoOk ? newCountriesByYear(geo) : [];
    const citiesByYear = geoOk ? newCitiesByYear(geo) : [];
    const newCountriesA = countriesByYear.find((y) => y.year === yearA)?.items.length ?? 0;
    const newCountriesB = countriesByYear.find((y) => y.year === yearB)?.items.length ?? 0;
    const newCitiesA = citiesByYear.find((y) => y.year === yearA)?.items.length ?? 0;
    const newCitiesB = citiesByYear.find((y) => y.year === yearB)?.items.length ?? 0;

    return {
      activityA,
      activityB,
      flightsA: flightsA.length,
      flightsB: flightsB.length,
      flightKmA: activityA.distanceByMode.FLYING ?? 0,
      flightKmB: activityB.distanceByMode.FLYING ?? 0,
      co2A: flightsA.reduce((s, f) => s + (f.co2Kg ?? 0), 0) / 1000,
      co2B: flightsB.reduce((s, f) => s + (f.co2Kg ?? 0), 0) / 1000,
      nightsTrackedA: nightsA.length,
      nightsTrackedB: nightsB.length,
      awayA,
      awayB,
      tripsA,
      tripsB,
      placesA,
      placesB,
      geoStale,
      geoA,
      geoB,
      newCountriesA,
      newCountriesB,
      newCitiesA,
      newCitiesB,
      modes: compareByMode(activityA.distanceByMode, activityB.distanceByMode, 8),
      monthlyDistance: alignMonths(yearA, activityA.distanceByPeriod, yearB, activityB.distanceByPeriod),
      monthlyNights: alignMonths(
        yearA,
        monthlyAwayNights(nights, yearA),
        yearB,
        monthlyAwayNights(nights, yearB),
      ),
    };
  }, [stats, flights, nights, trips, visits, geo, yearA, yearB]);

  if (sl || fl || nl || tl || vl || gl) return <Loader />;
  if (!comparison) return <EmptyState error={error} />;

  const allTime = range.start === null && range.end === null;
  const awayPctA = comparison.nightsTrackedA
    ? Math.round((comparison.awayA / comparison.nightsTrackedA) * 1000) / 10
    : 0;
  const awayPctB = comparison.nightsTrackedB
    ? Math.round((comparison.awayB / comparison.nightsTrackedB) * 1000) / 10
    : 0;
  const hasGeo = !comparison.geoStale && comparison.geoA && comparison.geoB;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Compare Years</h1>
        <p className="text-gray-400 mt-1">Two calendar years, side by side.</p>
        {!allTime && (
          <p className="text-xs text-gray-500 mt-1">
            The {label} time range doesn&apos;t apply here: each year is always compared in full.
          </p>
        )}
      </div>

      {/* Year pickers */}
      <div className="flex flex-wrap items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
        <YearPicker label="Year A" color={COLOR_A} value={yearA} years={years} onChange={(y) => pickYear('a', y)} />
        <button
          type="button"
          onClick={swap}
          title="Swap years"
          aria-label="Swap years"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 border border-gray-700 hover:text-white hover:bg-gray-800 transition-colors"
        >
          ⇄
        </button>
        <YearPicker label="Year B" color={COLOR_B} value={yearB} years={years} onChange={(y) => pickYear('b', y)} />
        {yearA === yearB && (
          <span className="text-xs text-gray-500">Comparing the same year twice.</span>
        )}
      </div>

      {/* Stat rows */}
      <StatSection title="Overview" yearA={yearA} yearB={yearB}>
        <StatRow label="Total distance" a={comparison.activityA.totalDistanceKm} b={comparison.activityB.totalDistanceKm} format={KM} />
        <StatRow label="Flights" a={comparison.flightsA} b={comparison.flightsB} format={COUNT} />
        <StatRow label="Flight distance" a={comparison.flightKmA} b={comparison.flightKmB} format={KM} />
        <StatRow
          label="Estimated CO₂"
          a={comparison.co2A}
          b={comparison.co2B}
          format={(v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`}
        />
        <StatRow label="Nights away" a={comparison.awayA} b={comparison.awayB} format={COUNT} />
        <StatRow label="% of year away" a={awayPctA} b={awayPctB} format={(v) => `${v}%`} points />
        <StatRow label="Trips" a={comparison.tripsA} b={comparison.tripsB} format={COUNT} />
        <StatRow label="Unique places" a={comparison.placesA} b={comparison.placesB} format={COUNT} />
      </StatSection>

      {hasGeo && comparison.geoA && comparison.geoB ? (
        <StatSection title="Places" yearA={yearA} yearB={yearB}>
          <StatRow label="Countries visited" a={comparison.geoA.countries.length} b={comparison.geoB.countries.length} format={COUNT} />
          <StatRow label="Cities visited" a={comparison.geoA.cities.length} b={comparison.geoB.cities.length} format={COUNT} />
          <StatRow label="New countries" a={comparison.newCountriesA} b={comparison.newCountriesB} format={COUNT} />
          <StatRow label="New cities" a={comparison.newCitiesA} b={comparison.newCitiesB} format={COUNT} />
        </StatSection>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-sm text-gray-400">
            <RegenerateHint /> to compare countries, cities, and new places between years.
          </p>
        </div>
      )}

      {comparison.modes.length > 0 && (
        <StatSection title="Distance by Mode" yearA={yearA} yearB={yearB}>
          {comparison.modes.slice(0, 5).map((m) => (
            <StatRow key={m.mode} label={MODE_LABELS[m.mode] || m.mode} a={m.a} b={m.b} format={KM} />
          ))}
        </StatSection>
      )}

      {/* Overlaid monthly charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Monthly Distance (km)">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={comparison.monthlyDistance}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} formatter={(value: number) => `${value.toLocaleString()} km`} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Line type="monotone" dataKey="a" name={String(yearA)} stroke={COLOR_A} strokeWidth={2} dot={{ r: 3 }} />
              <Line
                type="monotone"
                dataKey="b"
                name={String(yearB)}
                stroke={COLOR_B}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Monthly Nights Away">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={comparison.monthlyNights}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} formatter={(value: number) => `${value.toLocaleString()} nights`} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Line type="monotone" dataKey="a" name={String(yearA)} stroke={COLOR_A} strokeWidth={2} dot={{ r: 3 }} />
              <Line
                type="monotone"
                dataKey="b"
                name={String(yearB)}
                stroke={COLOR_B}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Mode split */}
      {comparison.modes.length > 0 && (
        <ChartCard title="Distance by Transport Mode (km)">
          <ResponsiveContainer width="100%" height={Math.max(240, comparison.modes.length * 48)}>
            <BarChart data={comparison.modes} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis
                dataKey="mode"
                type="category"
                tickFormatter={(m: string) => MODE_LABELS[m] || m}
                tick={{ fill: '#9ca3af', fontSize: 11 }}
                width={90}
              />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(m: string) => MODE_LABELS[m] || m}
                formatter={(value: number) => `${value.toLocaleString()} km`}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Bar dataKey="a" name={String(yearA)} fill={COLOR_A} radius={[0, 4, 4, 0]} />
              <Bar dataKey="b" name={String(yearB)} fill={COLOR_B} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}
