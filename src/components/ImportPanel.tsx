/**
 * In-browser import UI: a drop zone and file picker for Timeline.json, an
 * optional family-home config (the timeline-config.json format, pasted or
 * loaded from a file), and the running import's phase progress or error.
 *
 * The job itself lives in src/import/importJob.ts, so this can unmount
 * mid-import without losing it. Used by EmptyState (first import) and by
 * the footer's re-import dialog.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { parseTimelineConfig } from '../pipeline/familyHomes';
import type { FamilyHomeConfig } from '../pipeline/types';
import { IMPORT_PHASES } from '../import/protocol';
import { cancelImport, resetImport, startImport, useImportJob, type ImportJob } from '../import/importJob';
import { readConfigText } from '../import/storage';

const CONFIG_PLACEHOLDER = `{
  "familyHomes": [
    { "lat": 48.8584, "lng": 2.2945, "label": "Parents' house" }
  ]
}`;

const ERROR_TITLES: Record<Extract<ImportJob, { status: 'error' }>['kind'], string> = {
  format: "That's not a Timeline export",
  json: 'The file could not be parsed',
  memory: 'Out of memory',
  read: 'The file could not be read',
  crash: 'The import stopped',
  storage: 'The data could not be saved',
  other: 'The import failed',
};

interface ParsedConfig {
  familyHomes: FamilyHomeConfig[];
  error: string | null;
  warnings: string[];
}

function parseConfig(text: string): ParsedConfig {
  const warnings: string[] = [];
  if (!text.trim()) return { familyHomes: [], error: null, warnings };
  try {
    const familyHomes = parseTimelineConfig(text, 'timeline-config.json', (w) => warnings.push(w.trim()));
    return { familyHomes, error: null, warnings };
  } catch (err) {
    return { familyHomes: [], error: (err as Error).message, warnings };
  }
}

/** The dropped file to import: the first one, preferring a .json */
function pickFile(files: FileList): File | null {
  const list = [...files];
  return list.find((f) => f.name.toLowerCase().endsWith('.json')) ?? list[0] ?? null;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

export default function ImportPanel() {
  const job = useImportJob();
  const running = job.status === 'running';
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const configInput = useRef<HTMLInputElement>(null);

  const config = useMemo(() => parseConfig(configText), [configText]);

  // Prefill the config the current import was made with, for re-imports
  useEffect(() => {
    let cancelled = false;
    readConfigText().then(
      (stored) => {
        if (cancelled || !stored) return;
        setConfigText((current) => current || stored);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // A file dropped next to the drop zone would otherwise open in the tab
  useEffect(() => {
    const preventFileDrop = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', preventFileDrop);
    window.addEventListener('drop', preventFileDrop);
    return () => {
      window.removeEventListener('dragover', preventFileDrop);
      window.removeEventListener('drop', preventFileDrop);
    };
  }, []);

  const begin = (file: File) => {
    if (running) return;
    if (config.error) {
      setNotice('Fix the family-home config first, or empty it to import without one.');
      setConfigOpen(true);
      return;
    }
    setNotice(null);
    startImport(file, configText.trim() ? { text: configText, familyHomes: config.familyHomes } : null);
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = running ? 'none' : 'copy';
    if (!running) setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = pickFile(e.dataTransfer.files);
    if (file) begin(file);
  };

  const loadConfigFile = async (file: File) => {
    setConfigText(await file.text());
    setConfigOpen(true);
  };

  const phaseIndex = running ? IMPORT_PHASES.findIndex((p) => p.id === job.phase) : -1;

  return (
    <div className="space-y-4 text-left">
      {job.status === 'error' && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-1.5">
          <p className="font-medium text-red-300">{ERROR_TITLES[job.kind]}</p>
          <p className="text-sm text-red-100/80">{job.message}</p>
          {(job.kind === 'memory' || job.kind === 'crash') && (
            <p className="text-sm text-red-100/80">
              For very large exports, the command line can use more memory:{' '}
              <code className="text-orange-300">NODE_OPTIONS=--max-old-space-size=8192 npm run preprocess</code>{' '}
              (see README).
            </p>
          )}
          <p className="text-xs text-gray-500">
            File: {job.fileName} ·{' '}
            <button type="button" onClick={resetImport} className="text-gray-400 hover:text-white underline">
              Dismiss
            </button>
          </p>
        </div>
      )}

      {job.status === 'done' && (
        <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-sm text-emerald-200">
          ✓ Imported {job.fileName}: {plural(job.summary.flights, 'flight')},{' '}
          {plural(job.summary.nightsAway, 'night')} away, {plural(job.summary.trips, 'trip')} (
          {(job.summary.firstDate || '?').slice(0, 4)}–{(job.summary.lastDate || '?').slice(0, 4)}) in{' '}
          {(job.durationMs / 1000).toFixed(1)} s.
        </div>
      )}

      {running ? (
        <div className="border border-gray-800 rounded-xl p-5 space-y-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-300 min-w-0 truncate">
              Importing <span className="text-white font-medium">{job.fileName}</span>…
            </p>
            {job.phase !== 'saving' && (
              <button
                type="button"
                onClick={cancelImport}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 shrink-0"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${Math.round(((phaseIndex + 0.5) / IMPORT_PHASES.length) * 100)}%` }}
            />
          </div>
          <ol className="flex flex-wrap gap-1.5 text-xs">
            {IMPORT_PHASES.map((phase, i) => (
              <li
                key={phase.id}
                aria-current={i === phaseIndex ? 'step' : undefined}
                className={`px-2 py-0.5 rounded-md border ${
                  i < phaseIndex
                    ? 'border-gray-800 text-gray-400'
                    : i === phaseIndex
                      ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'
                      : 'border-gray-800 text-gray-600'
                }`}
              >
                {i < phaseIndex ? '✓ ' : ''}
                {phase.label}
                {i === phaseIndex && job.detail ? ` ${job.detail}` : ''}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-xl px-6 py-8 text-center space-y-2 transition-colors ${
            dragging ? 'border-orange-400 bg-orange-500/10' : 'border-gray-700'
          }`}
        >
          <div className="text-4xl">📥</div>
          <p className="text-white font-medium">
            Drop your <code className="text-orange-400">Timeline.json</code> here
          </p>
          <p className="text-sm text-gray-400">
            or{' '}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-300 hover:bg-orange-500/25 transition-colors"
            >
              choose the file
            </button>
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Timeline.json file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) begin(file);
            }}
          />
        </div>
      )}

      {notice && <p className="text-sm text-amber-300">{notice}</p>}

      {/* Family homes: optional, the timeline-config.json format */}
      <div className="border border-gray-800 rounded-xl">
        <button
          type="button"
          onClick={() => setConfigOpen((open) => !open)}
          aria-expanded={configOpen}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-gray-300 hover:text-white"
        >
          <span>
            🏡 Family homes <span className="text-gray-500">(optional)</span>
          </span>
          <span className={`text-xs ${config.error ? 'text-red-400' : 'text-gray-500'}`}>
            {config.error
              ? 'invalid config'
              : config.familyHomes.length > 0
                ? `${plural(config.familyHomes.length, 'family home')} ✓`
                : 'none'}{' '}
            {configOpen ? '▴' : '▾'}
          </span>
        </button>
        {configOpen && (
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-gray-400">
              Places you keep staying at without living there, like your parents' house: nights there
              don't count as away. Paste a <code className="text-orange-400">timeline-config.json</code>{' '}
              (see README, "Family Homes") or load one. It's kept in this browser with the imported data.
            </p>
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              disabled={running}
              rows={5}
              spellCheck={false}
              aria-label="Family-home config (timeline-config.json)"
              placeholder={CONFIG_PLACEHOLDER}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 font-mono text-xs text-gray-200 placeholder:text-gray-700 focus:outline-none focus:border-gray-600"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <button
                type="button"
                disabled={running}
                onClick={() => configInput.current?.click()}
                className="px-2.5 py-1 rounded-md border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
              >
                Load timeline-config.json…
              </button>
              {configText && !running && (
                <button type="button" onClick={() => setConfigText('')} className="text-gray-500 hover:text-white">
                  Clear
                </button>
              )}
              <input
                ref={configInput}
                type="file"
                accept=".json,application/json"
                aria-label="timeline-config.json file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void loadConfigFile(file);
                }}
              />
              {config.error && <span className="text-red-400">{config.error}</span>}
              {config.warnings.map((w) => (
                <span key={w} className="text-amber-300">{w}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 space-y-1.5">
        <p>
          🔒 Processed on this device, in a background thread of this page: nothing is uploaded. The
          result stays in this browser (IndexedDB) until you clear it.
        </p>
        <p>
          Prefer the command line? <code className="text-gray-400">npm run preprocess</code> writes the
          same data to <code className="text-gray-400">public/data/</code>, with optional online city
          lookups (see README).
        </p>
      </div>
    </div>
  );
}
