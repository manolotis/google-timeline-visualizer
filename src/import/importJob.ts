/**
 * The in-browser import job: one at a time, owned by this module (not by a
 * component) so its progress survives the drop zone unmounting, e.g. when
 * the user navigates to another page mid-import.
 *
 * startImport spawns the worker (worker.ts, created per import and
 * terminated after), relays its progress, saves the result to IndexedDB
 * (storage.ts) and calls reloadData so every page shows the new data.
 */
import { useSyncExternalStore } from 'react';
import { reloadData } from '../hooks/useData';
import type { FamilyHomeConfig } from '../pipeline/types';
import type { ImportErrorKind, ImportPhase, ImportRequest, ImportSummary, WorkerMessage } from './protocol';
import { IMPORT_FORMAT_VERSION, saveImport } from './storage';

export type ImportJob =
  | { status: 'idle' }
  | { status: 'running'; fileName: string; phase: ImportPhase; detail?: string }
  | {
      status: 'error';
      fileName: string;
      /** Worker errors, plus 'crash' (the worker died) and 'storage' (saving failed) */
      kind: ImportErrorKind | 'crash' | 'storage';
      message: string;
    }
  | { status: 'done'; fileName: string; summary: ImportSummary; durationMs: number };

/** The family-home config to import with: its text (stored alongside) and the validated homes */
export interface ImportConfig {
  text: string;
  familyHomes: FamilyHomeConfig[];
}

let job: ImportJob = { status: 'idle' };
let worker: Worker | null = null;
const listeners = new Set<() => void>();

function setJob(next: ImportJob) {
  job = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useImportJob(): ImportJob {
  return useSyncExternalStore(subscribe, () => job);
}

function stopWorker() {
  worker?.terminate();
  worker = null;
}

/** Imports `file` (with an optional family-home config); ignored while an import runs. */
export function startImport(file: File, config: ImportConfig | null): void {
  if (job.status === 'running') return;
  const startedAt = performance.now();
  const fileName = file.name;
  setJob({ status: 'running', fileName, phase: 'reading' });

  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  const fail = (kind: Extract<ImportJob, { status: 'error' }>['kind'], message: string) => {
    if (worker === w) stopWorker();
    setJob({ status: 'error', fileName, kind, message });
  };

  w.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    if (worker !== w) return; // cancelled
    const message = event.data;
    if (message.type === 'progress') {
      setJob({ status: 'running', fileName, phase: message.phase, detail: message.detail });
    } else if (message.type === 'error') {
      fail(message.kind, message.message);
    } else {
      stopWorker();
      setJob({ status: 'running', fileName, phase: 'saving' });
      const durationMs = Math.round(performance.now() - startedAt);
      try {
        await saveImport(
          message.datasets,
          {
            formatVersion: IMPORT_FORMAT_VERSION,
            importedAt: new Date().toISOString(),
            fileName,
            fileSize: file.size,
            summary: message.summary,
            durationMs,
          },
          config?.text ?? null,
        );
      } catch (err) {
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        fail(
          'storage',
          `The data was processed but this browser refused to store it (${reason}). ` +
            'Private windows and full disks can block storage; try a regular window.',
        );
        return;
      }
      reloadData();
      setJob({ status: 'done', fileName, summary: message.summary, durationMs });
    }
  };
  // Uncaught errors, including the worker failing to load or dying (typically out of memory)
  w.onerror = (event) => {
    event.preventDefault();
    fail(
      'crash',
      'The import stopped unexpectedly' +
        (event.message ? ` (${event.message})` : '') +
        '. The browser may have run out of memory: close other tabs and try again.',
    );
  };
  w.onmessageerror = () => fail('crash', 'The import worker sent a message that could not be read.');

  const request: ImportRequest = { file, familyHomes: config?.familyHomes ?? [] };
  w.postMessage(request);
}

/** Stops a running import; the previous data stays as it was. */
export function cancelImport(): void {
  if (job.status !== 'running' || job.phase === 'saving') return;
  stopWorker();
  setJob({ status: 'idle' });
}

/** Dismisses a finished or failed import. */
export function resetImport(): void {
  if (job.status === 'done' || job.status === 'error') setJob({ status: 'idle' });
}
