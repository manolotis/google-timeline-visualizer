/**
 * Shared UI constants: transport mode colors/labels and chart styling.
 *
 * Single source of truth for the mode palette used by the Overview,
 * Travel Map, and Statistics pages. Keys match the activity `type` values
 * in the raw Timeline.json export.
 */

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

/** Recharts <Tooltip> styling for the dark theme. */
export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
  },
  labelStyle: { color: '#fff' },
};
