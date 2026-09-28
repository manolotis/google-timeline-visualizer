/**
 * Shared UI constants: transport mode colors/labels, the night palette, and
 * chart styling.
 *
 * Single source of truth for the mode palette used by the Overview, Travel
 * Map, Statistics, and trip pages. Keys match the activity `type` values in
 * the raw Timeline.json export.
 */

export const APP_TITLE = 'Timeline Visualizer';

export const MODE_COLORS: Record<string, string> = {
  FLYING: '#f59e0b',
  WALKING: '#22c55e',
  CYCLING: '#3b82f6',
  IN_VEHICLE: '#a855f7',
  IN_PASSENGER_VEHICLE: '#ec4899',
  IN_TRAIN: '#06b6d4',
  IN_BUS: '#14b8a6',
  IN_SUBWAY: '#8b5cf6',
  IN_TRAM: '#64748b',
  IN_FERRY: '#0ea5e9',
  MOTORCYCLING: '#ef4444',
  RUNNING: '#10b981',
  SAILING: '#0284c7',
  SKIING: '#e2e8f0',
  UNKNOWN_ACTIVITY_TYPE: '#374151',
};

export const MODE_LABELS: Record<string, string> = {
  FLYING: 'Flying',
  WALKING: 'Walking',
  CYCLING: 'Cycling',
  IN_VEHICLE: 'Driving',
  IN_PASSENGER_VEHICLE: 'Taxi/Ride',
  IN_TRAIN: 'Train',
  IN_BUS: 'Bus',
  IN_SUBWAY: 'Subway',
  IN_TRAM: 'Tram',
  IN_FERRY: 'Ferry',
  MOTORCYCLING: 'Motorcycle',
  RUNNING: 'Running',
  SAILING: 'Sailing',
  SKIING: 'Skiing',
  UNKNOWN_ACTIVITY_TYPE: 'Unknown',
};

export const FALLBACK_MODE_COLOR = '#6b7280';

/** Nights at home (calendar heatmap, trip itinerary). */
export const HOME_NIGHT_COLOR = '#1a1a2e';

/** Away nights by distance from home, near (≤ 100 km) → far (> 1000 km). */
export const AWAY_NIGHT_COLORS = ['#fdba74', '#fb923c', '#f97316'] as const;

/**
 * Nights at a family home (neither home nor away): a muted teal, validated
 * against every away orange for color-vision-deficiency separation.
 */
export const FAMILY_NIGHT_COLOR = '#0d9488';

/** Family-home markers on maps: a lighter step of the same teal, for the dark basemap. */
export const FAMILY_HOME_COLOR = '#2dd4bf';

export function nightColor(night: { isHome: boolean; family?: string; distKm?: number }): string {
  if (night.family) return FAMILY_NIGHT_COLOR;
  if (night.isHome) return HOME_NIGHT_COLOR;
  const km = night.distKm ?? 0;
  return AWAY_NIGHT_COLORS[km > 1000 ? 2 : km > 100 ? 1 : 0];
}

/** Recharts <Tooltip> styling for the dark theme. */
export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
  },
  labelStyle: { color: '#fff' },
};
