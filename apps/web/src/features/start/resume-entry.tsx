import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { restoreRun } from '../../state/storage/restore-run';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import type { RunRecord } from '../../state/storage/records';
import { findResumable, loadRun, setRunStatus } from '../../state/storage/run-repository';
import type { StorageErrorKind } from '../../state/storage/storage-error';
import type { RunSettings } from '@escape-the-crypt/core';
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
  /** False when the host's announcer reads the message: the sentence then has no live role of its own. */
  readonly live?: boolean;
}

/** The two buttons. After a failed restore only "Start again" remains, under a plain sentence. */
export function ResumeEntryView({ onContinue, onStartAgain, failure, busy = false, live = true }: ResumeEntryViewProps): ReactNode {
  return (
    <div className="resume-entry" role="group" aria-label={RESUME_GROUP_LABEL} data-testid="resume-entry">
      {failure === null ? null : (
        <p className="resume-entry__message" role={live ? 'status' : undefined}>
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
  /** `settings` are the stored run's, so a fresh run of the same crypt keeps its length and difficulty. */
  readonly onStartAgain: (crypt: BuiltCrypt | null, settings?: RunSettings) => void;
  /** When set, a failed restore is read through the host's announcer, not a region of its own. */
  readonly announce?: (message: string) => void;
  /**
   * The run to offer. Without it the most recent active run is offered. With it, only that run, and
   * only while it is active: a desk with several books offers each book its own run.
   */
  readonly runId?: string;
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
export function ResumeEntry({ deps, onContinue, onStartAgain, announce, runId }: ResumeEntryProps): ReactNode {
  const { factory, notesStore, buildSample } = deps;
  const [run, setRun] = useState<RunRecord | null>(null);
  const [failure, setFailure] = useState<StorageErrorKind | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const lookup =
      runId === undefined
        ? findResumable(factory)
        : loadRun(factory, runId).then((loaded) => ({
            ok: true as const,
            value: loaded.ok && loaded.value.status === 'active' ? loaded.value : null,
          }));
    void lookup.then((found) => {
      if (alive.current && found.ok) setRun(found.value);
    });
    return () => {
      alive.current = false;
    };
  }, [factory, runId]);

  useEffect(() => {
    if (failure !== null) announce?.(restoreFailureText(failure));
  }, [failure, announce]);

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
        onStartAgain(result.ok ? generatedCrypt(result.value) : null, result.ok ? result.value.run.settings : undefined);
      });
  }, [run, factory, restoreDeps, onStartAgain]);

  if (run === null) return null;
  return <ResumeEntryView onContinue={doContinue} onStartAgain={doStartAgain} failure={failure} busy={busy} live={announce === undefined} />;
}
