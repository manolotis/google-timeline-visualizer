/**
 * The generated datasets' file names, and the pipeline's phases (for
 * progress reporting). Tiny and dependency-free, so the main thread can
 * import it without pulling the pipeline into the main bundle.
 */
import type { DatasetKey } from './types';

/** File name of every dataset, as written to public/data/ by the CLI. */
export const DATASET_FILES: Record<DatasetKey, string> = {
  home: 'home.json',
  flights: 'flights.json',
  visits: 'visits.json',
  nightsAway: 'nights-away.json',
  familyHomes: 'family-homes.json',
  geography: 'geography.json',
  trips: 'trips.json',
  routes: 'routes.json',
  stats: 'stats.json',
};

export const DATASET_KEYS = Object.keys(DATASET_FILES) as DatasetKey[];

/** The pipeline's phases, in the order runPipeline reports them. */
export const PIPELINE_PHASES = [
  { id: 'visits', label: 'Visits' },
  { id: 'cities', label: 'Cities' },
  { id: 'flights', label: 'Flights' },
  { id: 'nights', label: 'Nights' },
  { id: 'homes', label: 'Home periods' },
  { id: 'geography', label: 'Geography' },
  { id: 'trips', label: 'Trips' },
  { id: 'activities', label: 'Activities' },
  { id: 'routes', label: 'Routes' },
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number]['id'];
