/**
 * Shown when a page's data file could not be loaded — most commonly because
 * the preprocessing step hasn't been run yet.
 */
interface Props {
  error?: string | null;
}

export default function EmptyState({ error }: Props) {
  return (
    <div className="p-6 max-w-2xl mx-auto mt-12">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-3">
        <div className="text-4xl">🗂️</div>
        <h2 className="text-xl font-semibold text-white">No data available</h2>
        <p className="text-gray-400 text-sm">
          Place your <code className="text-orange-400">Timeline.json</code> export in the
          project root and run{' '}
          <code className="bg-gray-800 text-orange-400 px-1.5 py-0.5 rounded">
            npm run preprocess
          </code>{' '}
          to generate the dashboard data, then reload this page.
        </p>
        {error && (
          <p className="text-xs text-gray-600 font-mono">({error})</p>
        )}
      </div>
    </div>
  );
}
