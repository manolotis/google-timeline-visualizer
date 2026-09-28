/**
 * Page footer naming where the dashboard's data comes from, with the import
 * affordances: re-import (a dialog around ImportPanel) and clearing an
 * in-browser import. Hidden when there's no data at all, since EmptyState
 * then offers the import itself.
 */
import { useEffect, useState } from 'react';
import { reloadData, useDataSource, useStats } from '../hooks/useData';
import { resetImport, useImportJob } from '../import/importJob';
import { clearImport } from '../import/storage';
import ImportPanel from './ImportPanel';

function ImportDialog({ onClose, subtitle }: { onClose: () => void; subtitle: string }) {
  const job = useImportJob();
  const running = job.status === 'running';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/70 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-6 w-full max-w-2xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="import-dialog-title" className="text-lg font-semibold text-white">
              Import Timeline.json
            </h2>
            <p className="text-sm text-gray-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            aria-label="Close"
            className="text-gray-500 hover:text-white disabled:opacity-30 px-1"
          >
            ✕
          </button>
        </div>
        <ImportPanel />
      </div>
    </div>
  );
}

const linkButton = 'text-gray-400 hover:text-white underline underline-offset-2 decoration-gray-600';

export default function DataFooter() {
  const source = useDataSource();
  const { data: stats } = useStats();
  const job = useImportJob();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  if (!source) return null;
  const imported = source.kind === 'imported' ? source.meta : null;
  const staleImport = source.kind === 'static' && source.staleImport;
  // No data at all: the page's EmptyState offers the import
  if (!imported && !stats && !staleImport) return null;

  const openImport = () => {
    resetImport();
    setDialogOpen(true);
  };

  const clear = async () => {
    try {
      await clearImport();
    } catch (err) {
      setClearError(`Could not clear: ${(err as Error).message}`);
      return;
    }
    setConfirmingClear(false);
    setClearError(null);
    resetImport();
    reloadData();
  };

  // The dialog closes itself once an import is saved
  const showDialog = dialogOpen && job.status !== 'done';

  const clearControls = confirmingClear ? (
    <span className="text-gray-300">
      Remove the imported data and family-home config from this browser?{' '}
      <button type="button" onClick={() => void clear()} className="text-red-300 hover:text-red-200 underline underline-offset-2">
        Yes, clear
      </button>{' '}
      <button type="button" onClick={() => setConfirmingClear(false)} className={linkButton}>
        Cancel
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirmingClear(true)} className={linkButton}>
      Clear imported data
    </button>
  );

  let description: string;
  if (imported) {
    const when = new Date(imported.importedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const { firstDate, lastDate, familyHomes } = imported.summary;
    const years = firstDate && lastDate ? ` · ${firstDate.slice(0, 4)}–${lastDate.slice(0, 4)}` : '';
    const family = familyHomes > 0 ? ` · ${familyHomes} family home${familyHomes === 1 ? '' : 's'}` : '';
    description = `Imported in this browser from ${imported.fileName} on ${when}${years}${family}`;
  } else if (staleImport) {
    description = 'An import from an older version of this app is stored in this browser but can no longer be read; re-import it';
  } else {
    description = 'Data from public/data/ (command-line preprocess)';
  }

  return (
    <>
      <footer className="max-w-7xl mx-auto px-6 pb-6">
        <div className="border-t border-gray-800/70 pt-4 text-xs text-gray-500 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>📂 {description}</span>
          <button type="button" onClick={openImport} className={linkButton}>
            {imported || staleImport ? 'Re-import' : 'Import Timeline.json in the browser'}
          </button>
          {(imported || staleImport) && clearControls}
          {clearError && <span className="text-red-400">{clearError}</span>}
          <span className="sm:ml-auto">🔒 Processed and stored locally; nothing is uploaded</span>
        </div>
      </footer>
      {showDialog && (
        <ImportDialog
          onClose={() => setDialogOpen(false)}
          subtitle={
            imported
              ? `Replaces the data imported on ${new Date(imported.importedAt).toLocaleDateString()}.`
              : 'Imported data takes precedence over public/data/ until you clear it.'
          }
        />
      )}
    </>
  );
}
