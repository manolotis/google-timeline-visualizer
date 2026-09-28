/**
 * Root application component.
 *
 * Renders a sticky top navigation bar with page links and the global
 * time-range control, and conditionally mounts the page named by the URL
 * hash below (see route.ts). TimeRangeProvider wraps the page switch so the
 * selected range survives navigation (pages unmount when you switch tabs).
 */
import { useEffect } from 'react';
import { routeHref, useRoute, type Page, type Route } from './route';
import { selectionToParams, useTimeRange } from './timeRange';
import TimeRangeProvider from './components/TimeRangeProvider';
import TimeRangeControl from './components/TimeRangeControl';
import Overview from './pages/Overview';
import Flights from './pages/Flights';
import NightsAway from './pages/NightsAway';
import TravelMap from './pages/TravelMap';
import Statistics from './pages/Statistics';
import Geography from './pages/Geography';

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'flights', label: 'Flights', icon: '✈️' },
  { id: 'nights', label: 'Nights Away', icon: '🌙' },
  { id: 'map', label: 'Travel Map', icon: '🗺️' },
  { id: 'statistics', label: 'Statistics', icon: '📈' },
  { id: 'geography', label: 'Geography', icon: '🧭' },
];

const APP_TITLE = 'Timeline Visualizer';

/**
 * Page links as real anchors (so middle-click / cmd-click open a new tab).
 * Each carries the current time range; the active one points at the current
 * view exactly, page-local state included, so clicking it changes nothing.
 * Also names the browser tab after the view, for bookmarks and the history
 * menu.
 */
function NavLinks({ route }: { route: Route }) {
  const { selection, range, label } = useTimeRange();
  const rangeParams = selectionToParams(selection);

  const pageLabel = NAV_ITEMS.find((item) => item.id === route.page)?.label;
  const allTime = range.start === null && range.end === null;
  useEffect(() => {
    document.title = [pageLabel, allTime ? null : label, APP_TITLE].filter(Boolean).join(' · ');
  }, [pageLabel, allTime, label]);

  return (
    <div className="flex gap-1 overflow-x-auto min-w-0 flex-1">
      {NAV_ITEMS.map((item) => {
        const active = item.id === route.page;
        return (
          <a
            key={item.id}
            href={active ? routeHref(route) : routeHref({ page: item.id, params: rangeParams })}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            className={`px-1.5 sm:px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              active
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            <span className="mr-1.5">{item.icon}</span>
            <span className="hidden lg:inline">{item.label}</span>
          </a>
        );
      })}
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const { page } = route;

  return (
    <TimeRangeProvider>
      <div className="min-h-screen bg-gray-950">
        {/* Top nav */}
        <nav className="bg-gray-900/80 backdrop-blur border-b border-gray-800 sticky top-0 z-50">
          {/* Widths are tuned so tabs + range control fit without scrolling
              down to 360px; the logo yields its space where the tab labels
              appear (lg) and returns with the title (xl) */}
          <div className="max-w-7xl mx-auto px-3 sm:px-4 flex items-center gap-3 h-14">
            <div className="font-bold text-white mr-5 hidden sm:flex lg:hidden xl:flex items-center gap-2 shrink-0">
              <span className="text-xl">🌍</span>
              <span className="hidden xl:inline">{APP_TITLE}</span>
            </div>
            <NavLinks route={route} />
            <TimeRangeControl />
          </div>
        </nav>

        {/* Page content */}
        <main>
          {page === 'overview' && <Overview />}
          {page === 'flights' && <Flights />}
          {page === 'nights' && <NightsAway />}
          {page === 'map' && <TravelMap />}
          {page === 'statistics' && <Statistics />}
          {page === 'geography' && <Geography />}
        </main>
      </div>
    </TimeRangeProvider>
  );
}
