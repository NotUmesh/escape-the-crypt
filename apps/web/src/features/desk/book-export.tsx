import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { restoreRun } from '../../state/storage/restore-run';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import type { StorageResult } from '../../state/storage/storage-error';
import {
  EXPORT_BUTTON_LABEL,
  EXPORT_DONE_TEXT,
  EXPORT_FAILED_TEXT,
  EXPORT_NO_NOTES_TEXT,
} from '../start/export-control';
import { downloadJson, prepareExport } from '../start/export-support';
import type { ExportOutcome, ExportRunInput } from '../start/export-support';

export interface BookExportProps {
  readonly runId: string;
  readonly deps: RestoreDeps;
  /** Receives the result sentence for the shell announcer. The sentence is also shown. */
  readonly onStatus: (text: string) => void;
  /** Seams for tests. They default to the real restore, export and download. */
  readonly restore?: (deps: RestoreDeps, runId: string) => Promise<StorageResult<RestoredRun>>;
  readonly prepare?: (input: ExportRunInput) => Promise<ExportOutcome>;
  readonly download?: (json: string) => void;
}

/**
 * "Export a copy" for a saved book. It restores the run (reads only), builds the same export the
 * run screen builds, and downloads it. The result sentence is plain text with no live role of
 * its own: the shell announcer reads it.
 */
export function BookExport({
  runId,
  deps,
  onStatus,
  restore = restoreRun,
  prepare = prepareExport,
  download = downloadJson,
}: BookExportProps): ReactNode {
  const [working, setWorking] = useState(false);
  const [text, setText] = useState('');
  const finish = useCallback(
    (next: string): void => {
      setWorking(false);
      setText(next);
      onStatus(next);
    },
    [onStatus],
  );
  const onExport = useCallback((): void => {
    setWorking(true);
    setText('');
    void (async () => {
      const restored = await restore(deps, runId);
      if (!restored.ok) return finish(EXPORT_FAILED_TEXT);
      const { model, assets, events } = restored.value;
      const outcome = await prepare({ state: model.state, assets, eventLog: events, runId, deps });
      if (!outcome.ok) return finish(EXPORT_FAILED_TEXT);
      try {
        download(outcome.json);
      } catch {
        return finish(EXPORT_FAILED_TEXT);
      }
      return finish(outcome.withNotes ? EXPORT_DONE_TEXT : EXPORT_NO_NOTES_TEXT);
    })();
  }, [restore, prepare, download, deps, runId, finish]);
  return (
    <div className="book-export" data-testid="book-export">
      <button type="button" className="fh-button" onClick={onExport} disabled={working}>
        {EXPORT_BUTTON_LABEL}
      </button>
      <p className="fh-note" data-testid="book-export-status">
        {text}
      </p>
    </div>
  );
}
