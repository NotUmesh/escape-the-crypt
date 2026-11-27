import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { restoreRun } from '../../state/storage/restore-run';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import type { RunRecord } from '../../state/storage/records';
import { findResumable, setRunStatus } from '../../state/storage/run-repository';
import type { StorageErrorKind } from '../../state/storage/storage-error';
import type { BuiltCrypt } from '../../state/room-binding';

export const CONTINUE_LABEL = 'Continue your crypt';
export const START_AGAIN_LABEL = 'Start again';
export const RESUME_GROUP_LABEL = 'Your saved crypt';
export const RESTORE_FAILED_TEXT =
  'The saved crypt could not be opened on this device. Start again opens the sample crypt instead.';
export const NOTES_MISSING_TEXT =
  'The notes for this crypt are missing from this device. Start again opens the sample crypt instead.';

/** What the learner is told when restoring failed. Only the kind decides the sentence. */
export function restoreFailureText(kind: StorageErrorKind): string {
  return kind === 'notes-unavailable' ? NOTES_MISSING_TEXT : RESTORE_FAILED_TEXT;
}

export interface ResumeEntryViewProps {
  readonly onContinue: () => void;
  readonly onStartAgain: () => void;
  /** Set after a failed restore. */
  readonly failure: StorageErrorKind | null;
  readonly busy?: boolean;
}

/** The two buttons. After a failed restore only "Start again" remains, under a plain sentence. */
export function ResumeEntryView({ onContinue, onStartAgain, failure, busy = false }: ResumeEntryViewProps): ReactNode {
  return (
    <div className="resume-entry" role="group" aria-label={RESUME_GROUP_LABEL} data-testid="resume-entry">
      {failure === null ? null : (
        <p className="resume-entry__message" role="status">
          {restoreFailureText(failure)}
        </p>
      )}
      {failure === null ? (
        <button type="button" className="resume-entry__button" onClick={onContinue} disabled={busy}>
          {CONTINUE_LABEL}
        </button>
      ) : null}
      <button type="button" className="resume-entry__button" onClick={onStartAgain} disabled={busy}>
        {START_AGAIN_LABEL}
      </button>
    </div>
  );
}

export interface ResumeEntryProps {
  readonly deps: RestoreDeps;
  /** Called with the restored run; the binding then shows the screen it describes. */
  readonly onContinue: (restored: RestoredRun) => void;
  /**
   * Called once the previous run is `left`. `crypt` is the generated crypt to play again, or null
   * when the sample crypt should be played.
   */
  readonly onStartAgain: (crypt: BuiltCrypt | null) => void;
}

function generatedCrypt(restored: RestoredRun): BuiltCrypt | null {
  if (restored.crypt.source !== 'generated') return null;
  return {
    manifest: restored.model.manifest,
    content: restored.crypt.content,
    chunks: restored.assets.chunks,
    source: 'notes',
    ...(restored.crypt.documentDigest === undefined ? {} : { documentDigest: restored.crypt.documentDigest }),
  };
}

/**
 * Looks up the most recent active run when it mounts. Shows nothing when there is none or the
 * lookup fails, so the start screen keeps only its own buttons.
 */
export function ResumeEntry({ deps, onContinue, onStartAgain }: ResumeEntryProps): ReactNode {
  const { factory, notesStore, buildSample } = deps;
  const [run, setRun] = useState<RunRecord | null>(null);
  const [failure, setFailure] = useState<StorageErrorKind | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void findResumable(factory).then((found) => {
      if (alive.current && found.ok) setRun(found.value);
    });
    return () => {
      alive.current = false;
    };
  }, [factory]);

  const restoreDeps = useCallback((): RestoreDeps => ({ factory, notesStore, buildSample }), [factory, notesStore, buildSample]);

  const doContinue = useCallback((): void => {
    if (run === null) return;
    setBusy(true);
    void restoreRun(restoreDeps(), run.runId).then((result) => {
      if (!alive.current) return;
      setBusy(false);
      if (result.ok) onContinue(result.value);
      else setFailure(result.error.kind);
    });
  }, [run, restoreDeps, onContinue]);

  const doStartAgain = useCallback((): void => {
    if (run === null) return;
    setBusy(true);
    // The previous run keeps its events; only its status changes.
    void setRunStatus(factory, run.runId, 'left')
      .then(() => restoreRun(restoreDeps(), run.runId))
      .then((result) => {
        if (!alive.current) return;
        setBusy(false);
        onStartAgain(result.ok ? generatedCrypt(result.value) : null);
      });
  }, [run, factory, restoreDeps, onStartAgain]);

  if (run === null) return null;
  return <ResumeEntryView onContinue={doContinue} onStartAgain={doStartAgain} failure={failure} busy={busy} />;
}
