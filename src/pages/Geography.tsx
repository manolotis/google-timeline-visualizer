/**
 * Geography page — country and city stay durations derived from away nights.
 *
 * Shows ranked country and city totals for the globally selected time
 * range, with charts and full tables for all matched destinations. The
 * country table also lists days present in the range (home time included),
 * the measure the Overview world map uses.
 */
import { useMemo } from 'react';
import Loader from '../components/Loader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import NoDataInRange from '../components/NoDataInRange';
import { CHART_TOOLTIP_STYLE } from '../constants';
import { useGeography } from '../hooks/useData';
import { isStaleGeography, summarizeGeography } from '../aggregate';
import { useTimeRange } from '../timeRange';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COUNTRY_COLOR = '#f59e0b';
const CITY_COLOR = '#06b6d4';

const tooltipStyle = CHART_TOOLTIP_STYLE;

export default function Geography() {
  const { data: geo, loading, error } = useGeography();
  const { range } = useTimeRange();

  const stale = !!geo && isStaleGeography(geo);
  const data = useMemo(
    () => (geo && !stale ? summarizeGeography(geo, range) : null),
    [geo, stale, range],
  );

  if (loading) return <Loader />;
  if (!data) {
    return <EmptyState error={stale ? 'geography.json predates this version' : error} />;
  }

  const header = (
    <div>
      <h1 className="text-3xl font-bold text-white">Geography</h1>
      <p className="text-gray-400 mt-1">
        Away-night totals grouped by matched country and city.
      </p>
    </div>
  );

  if (data.totalAwayDays === 0 && data.countries.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-8">
        {header}
        <NoDataInRange title="No visits recorded in this range" />
      </div>
    );
  }

  // Countries only present in the range (e.g. home) have no away days to chart
  const awayCountries = data.countries.filter((country) => country.days > 0);
  const topCountry = awayCountries[0] ?? null;
  const topCity = data.cities[0] ?? null;
  const noAwayText = data.totalAwayDays === 0 ? 'No nights away' : 'No matched data';
  const topCountries = awayCountries.slice(0, 12).map((country) => ({
    ...country,
    fill: COUNTRY_COLOR,
  }));
  const topCities = data.cities.slice(0, 15).map((city) => ({
    ...city,
    label: `${city.city}, ${city.country}`,
    fill: CITY_COLOR,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon="🌍"
          label="Countries Visited"
          value={data.countries.length}
          sub={`${data.totalAwayDays.toLocaleString()} away days total`}
        />
        <StatCard
          icon="🏙️"
          label="Cities Visited"
          value={data.cities.length}
          sub={`${data.matchedDays.toLocaleString()} matched city-days`}
        />
        <StatCard
          icon="🥇"
          label="Top Country"
          value={topCountry?.country ?? '—'}
          sub={
            topCountry
              ? `${topCountry.days} away days · ${topCountry.totalDays.toLocaleString()} present`
              : noAwayText
          }
        />
        <StatCard
          icon="📌"
          label="Top City"
          value={topCity?.city ?? '—'}
          sub={topCity ? `${topCity.days} away days in ${topCity.country}` : noAwayText}
        />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <p className="text-sm text-gray-400">
          {data.totalAwayDays === 0
            ? 'No nights away from home in this range; the country table lists the days present.'
            : data.unmatchedDays > 0
              ? `${data.unmatchedDays} away days could not be matched to a known city in the embedded dataset.`
              : 'All away days were matched to a city in the embedded dataset.'}
        </p>
      </div>

      {data.matchedDays > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Top Countries by Away Days</h2>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={topCountries} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis
                  dataKey="country"
                  type="category"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  width={110}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: number, _name, item: { payload?: { shareOfAwayDays?: number } }) => {
                    const share = item.payload?.shareOfAwayDays ?? 0;
                    return [`${value.toLocaleString()} days`, `${share}% of away days`];
                  }}
                />
                <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                  {topCountries.map((entry) => (
                    <Cell key={entry.country} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Top Cities by Away Days</h2>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={topCities} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis
                  dataKey="label"
                  type="category"
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  width={150}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: number, _name, item: { payload?: { shareOfAwayDays?: number } }) => {
                    const share = item.payload?.shareOfAwayDays ?? 0;
                    return [`${value.toLocaleString()} days`, `${share}% of away days`];
                  }}
                />
                <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                  {topCities.map((entry) => (
                    <Cell key={entry.label} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">All Countries</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Country</th>
                  <th className="px-3 py-2">Away days</th>
                  <th className="px-3 py-2">Share</th>
                  <th className="px-3 py-2" title="Days with at least one recorded visit, home time included">
                    Days present
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.countries.map((country, index) => (
                  <tr key={country.country} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2 text-gray-200 font-medium">{country.country}</td>
                    <td className="px-3 py-2 text-gray-300">{country.days}</td>
                    <td className="px-3 py-2 text-gray-400">{country.shareOfAwayDays}%</td>
                    <td className="px-3 py-2 text-gray-300">{country.totalDays.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-4">All Cities</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">City</th>
                  <th className="px-3 py-2">Country</th>
                  <th className="px-3 py-2">Away days</th>
                  <th className="px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.cities.map((city, index) => (
                  <tr key={`${city.city}-${city.country}`} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                    <td className="px-3 py-2 text-gray-200 font-medium">{city.city}</td>
                    <td className="px-3 py-2 text-gray-400">{city.country}</td>
                    <td className="px-3 py-2 text-gray-300">{city.days}</td>
                    <td className="px-3 py-2 text-gray-400">{city.shareOfAwayDays}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}