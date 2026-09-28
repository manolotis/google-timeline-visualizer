/**
 * Shown in place of a page's content when the selected time range contains
 * none of the data that page displays.
 */
import { useTimeRange } from '../timeRange';

interface Props {
  /** Headline, e.g. "No flights in this range" */
  title?: string;
}

export default function NoDataInRange({ title = 'No data in this range' }: Props) {
  const { label, valid, setSelection } = useTimeRange();
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-3">
      <div className="text-4xl">📭</div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-sm text-gray-400">
        {valid
          ? `Nothing was recorded in the selected period (${label}).`
          : 'The custom range ends before it starts.'}{' '}
        Pick another period with the 📅 control in the top bar.
      </p>
      <button
        type="button"
        onClick={() => setSelection({ kind: 'all' })}
        className="px-3 py-1.5 rounded-lg text-sm bg-orange-500/15 border border-orange-500/40 text-orange-300 hover:bg-orange-500/25 transition-colors"
      >
        Show all time
      </button>
    </div>
  );
}
