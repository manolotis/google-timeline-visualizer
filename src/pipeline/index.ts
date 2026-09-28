/**
 * The preprocessing pipeline: Timeline.json → the dashboard's datasets.
 *
 * Shared by the Node CLI (scripts/preprocess.ts) and the in-browser import
 * worker (src/import/worker.ts). Everything under src/pipeline/ is
 * environment-agnostic: plain ES2022, no DOM, no Node, no network (checked
 * by `npm run typecheck` against tsconfig.pipeline.json).
 *
 *   runPipeline(timeline, { cityDb, countries, airports, familyHomes }, options)
 *     → { datasets, cityStats }
 */
export { runPipeline, validateTimeline, TimelineFormatError } from './run';
export type { PipelineInputs, PipelineOptions, PipelineResult } from './run';
export {
  CityResolver,
  DEFAULT_CITY_BUCKET_DEG,
  buildCityDb,
  serializeCityDb,
} from './cities';
export type { CityDb, CityResolverOptions, CityResolverStats, OnlineGeocoder } from './cities';
export { parseTimelineConfig } from './familyHomes';
export { DEFAULT_HOME_MIN_PERIOD_MONTHS } from './homes';
export { DATASET_FILES, DATASET_KEYS, PIPELINE_PHASES } from './datasets';
export type { PipelinePhase } from './datasets';
export type * from './types';
