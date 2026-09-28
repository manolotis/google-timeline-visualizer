/**
 * Shown when a page's data could not be loaded — most commonly because no
 * data exists yet: neither an in-browser import nor `npm run preprocess`
 * output. Offers the in-browser import right here.
 */
import ImportPanel from './ImportPanel';

interface Props {
  error?: string | null;
}

export default function EmptyState({ error }: Props) {
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto mt-6 sm:mt-12">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-8 space-y-5">
        <div className="text-center space-y-2">
          <div className="text-4xl">🗂️</div>
          <h2 className="text-xl font-semibold text-white">Import your timeline</h2>
          <p className="text-gray-400 text-sm">
            Load the <code className="text-orange-400">Timeline.json</code> you exported from Google Maps
            on your phone (see README, "How to Get Your Timeline Data") to build the dashboard.
          </p>
        </div>
        <ImportPanel />
        {error && (
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer hover:text-gray-400">Why am I seeing this?</summary>
            <p className="mt-1">
              No dashboard data could be loaded (<span className="font-mono">{error}</span>).
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
