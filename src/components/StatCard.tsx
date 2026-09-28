/** Reusable stat card displaying an icon, numeric value, label, and optional subtitle. */
interface Props {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
}

export default function StatCard({ label, value, sub, icon }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-start gap-4">
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="text-2xl font-bold text-white">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </div>
        <div className="text-sm text-gray-400 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
      </div>
    </div>
  );
}
