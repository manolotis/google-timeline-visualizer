/**
 * Messages between the main thread (importJob.ts) and the import worker
 * (worker.ts), and the import's phases for progress display.
 */
import { PIPELINE_PHASES, type PipelinePhase } from '../pipeline/datasets';
import type { DatasetKey, FamilyHomeConfig } from '../pipeline/types';

export type ImportPhase = 'reading' | 'parsing' | PipelinePhase | 'saving';

/** Every phase of an import, in order: the worker's, then saving on the main thread. */
export const IMPORT_PHASES: readonly { id: ImportPhase; label: string }[] = [
  { id: 'reading', label: 'Reading file' },
  { id: 'parsing', label: 'Parsing JSON' },
  ...PIPELINE_PHASES,
  { id: 'saving', label: 'Saving' },
];

/** Main thread → worker: process this file. */
export interface ImportRequest {
  file: File;
  /** Validated family homes (parseTimelineConfig); [] for none */
  familyHomes: FamilyHomeConfig[];
}

/** A few headline numbers of an import, shown in the footer. */
export interface ImportSummary {
  segments: number;
  flights: number;
  nights: number;
  nightsAway: number;
  trips: number;
  countries: number;
  familyHomes: number;
  /** Local dates of the first and last night */
  firstDate: string;
  lastDate: string;
}

export type ImportErrorKind =
  /** Not a Timeline export (other JSON, a ZIP, the old Takeout format…) */
  | 'format'
  /** Invalid or truncated JSON */
  | 'json'
  /** Ran out of memory, or the file is too large for the browser */
  | 'memory'
  /** The browser couldn't read the file */
  | 'read'
  | 'other';

/** Worker → main thread. */
export type WorkerMessage =
  | { type: 'progress'; phase: ImportPhase; detail?: string }
  | {
      type: 'done';
      /** Every dataset as JSON text, exactly what the CLI writes to public/data/ */
      datasets: Record<DatasetKey, string>;
      summary: ImportSummary;
      /** Milliseconds spent in each phase */
      timings: Partial<Record<ImportPhase, number>>;
    }
  | { type: 'error'; kind: ImportErrorKind; message: string };
