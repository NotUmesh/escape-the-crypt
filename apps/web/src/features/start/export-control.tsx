import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { State } from '@escape-the-crypt/core';
import type { RoomBinding } from '../../state/room-binding';
import type { RestoreDeps } from '../../state/storage/restore-run';
import { downloadJson, prepareExport } from './export-support';
import type { ExportRunInput } from './export-support';

/** The button label says the file holds the learner's notes (Req 13.3). */
export const EXPORT_BUTTON_LABEL = 'Export a copy (this file contains your notes)';
export const EXPORT_DONE_TEXT = 'Your copy was downloaded. It contains your notes, so keep it somewhere private.';
export const EXPORT_NO_NOTES_TEXT =
  "Your notes aren't available on this device any more, so the copy was exported without them.";
export const EXPORT_FAILED_TEXT = "We couldn't make a copy this time. Try again.";

export interface ExportControlProps extends ExportRunInput {
  /**
   * When set, the result sentence goes to the host's one announcer and the sentence on screen has
   * no live role of its own.
   */
  readonly onStatus?: (text: string) => void;
}

/** The control for the Save_Banner slot, or nothing before the run has its assets. */
export function exportSlotFor(
  binding: Pick<RoomBinding, 'assets' | 'eventLog' | 'runId'>,
  state: State,
  deps: RestoreDeps,
  onStatus?: (text: string) => void,
): ReactNode {
  if (binding.assets === null) return null;
  return (
    <ExportControl
      state={state}
      assets={binding.assets}
      eventLog={binding.eventLog}
      runId={binding.runId ?? 'unsaved-run'}
      deps={deps}
      onStatus={onStatus}
    />
  );
}

type Status = 'idle' | 'working' | 'done' | 'no-notes' | 'failed';

const STATUS_TEXT: Readonly<Record<Status, string>> = {
  idle: '',
  working: '',
  done: EXPORT_DONE_TEXT,
  'no-notes': EXPORT_NO_NOTES_TEXT,
  failed: EXPORT_FAILED_TEXT,
};

/** Download-only export of the run. There is no import. */
export function ExportControl(props: ExportControlProps): ReactNode {
  const [status, setStatus] = useState<Status>('idle');
  const { state, assets, eventLog, runId, deps, onStatus } = props;
  const finish = useCallback(
    (next: Status): void => {
      setStatus(next);
      onStatus?.(STATUS_TEXT[next]);
    },
    [onStatus],
  );
  const onExport = useCallback((): void => {
    setStatus('working');
    void prepareExport({ state, assets, eventLog, runId, deps }).then((outcome) => {
      if (!outcome.ok) {
        finish('failed');
        return;
      }
      try {
        downloadJson(outcome.json);
        finish(outcome.withNotes ? 'done' : 'no-notes');
      } catch {
        finish('failed');
      }
    });
  }, [state, assets, eventLog, runId, deps, finish]);
  return (
    <div className="export-control" data-testid="export-control">
      <button type="button" className="export-control__button" onClick={onExport} disabled={status === 'working'} aria-disabled={status === 'working' || undefined}>
        {EXPORT_BUTTON_LABEL}
      </button>
      <p
        className="export-control__status"
        aria-live={onStatus === undefined ? 'polite' : undefined}
        data-testid="export-status"
      >
        {STATUS_TEXT[status]}
      </p>
    </div>
  );
}
