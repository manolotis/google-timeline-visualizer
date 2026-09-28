/**
 * Root application component.
 *
 * Renders a sticky top navigation bar with page tabs (Overview, Flights,
 * Nights Away, Travel Map, Statistics) and conditionally mounts the
 * selected page component below.
 */
import { useState } from 'react';
import type { Page } from './types';
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
  { id: 'stats', label: 'Statistics', icon: '📈' },
  { id: 'geography', label: 'Geography', icon: '🧭' },
];

export default function App() {
  const [page, setPage] = useState<Page>('overview');

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Top nav */}
      <nav className="bg-gray-900/80 backdrop-blur border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 flex items-center h-14">
          <div className="font-bold text-white mr-8 flex items-center gap-2">
            <span className="text-xl">🌍</span>
            <span className="hidden sm:inline">Timeline Visualizer</span>
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  page === item.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                <span className="mr-1.5">{item.icon}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main>
        {page === 'overview' && <Overview />}
        {page === 'flights' && <Flights />}
        {page === 'nights' && <NightsAway />}
        {page === 'map' && <TravelMap />}
        {page === 'stats' && <Statistics />}
        {page === 'geography' && <Geography />}
      </main>
    </div>
  );
}
