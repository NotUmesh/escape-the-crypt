import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event, Outcome_Notice } from '@escape-the-crypt/core';
import type { RoomAction } from './room-actions';
import { settingsOf, useRoomBinding } from './room-binding';
import type { BuildCrypt, BuiltCrypt, RoomBinding } from './room-binding';
import { saveCrypt } from './storage/crypt-repository';
import { createEventWriter } from './storage/event-writer';
import type { EventWriter, WriteOutcome } from './storage/event-writer';
import { appendEvent, createRun, setRunStatus } from './storage/run-repository';
import { restoreRun } from './storage/restore-run';
import type { RestoredRun } from './storage/restore-run';
import type { RunLockState } from './storage/run-lock';
import { newSession } from './persisted-room-session';
import { browserChannelFactory, browserFactory, browserLocks, canWrite } from './persisted-room-support';
import type { PersistedRoomOptions, Session } from './persisted-room-support';
import { createIdbStore } from '../features/ingest/notes-store-idb';
import { storageError } from './storage/storage-error';
import type { StorageResult } from './storage/storage-error';

export type { PersistedRoomOptions };

/**
 * Wraps `useRoomBinding` with persistence. In-memory state is shown at once. The notices of an
 * accepted Event are held back until its append settles (saved, failed or skipped), then released.
 * A rejected action leaves `eventLog` unchanged, so nothing is enqueued for it.
 */
export function usePersistedRoom(buildCrypt: BuildCrypt, options: PersistedRoomOptions = {}): RoomBinding {
  const factory = 'factory' in options ? options.factory : browserFactory();
  const now = options.now ?? Date.now;
  const newRunId = options.newRunId ?? ((): string => crypto.randomUUID());
  const animate = options.animate;
  const locks = 'locks' in options ? options.locks : browserLocks();
  const channelFactory = 'channelFactory' in options ? options.channelFactory : browserChannelFactory();
  const notesStoreOption = options.notesStore;

  const built = useRef<BuiltCrypt | null>(null);
  const capturing = useCallback<BuildCrypt>(() => {
    const result = buildCrypt();
    if (result.ok) built.current = result.value;
    return result;
  }, [buildCrypt]);
  const binding = useRoomBinding(capturing);

  const session = useRef<Session | null>(null);
  const sessionCount = useRef(0);
  const pendingStart = useRef(false);
  const heldRef = useRef<readonly Outcome_Notice[]>([]);
  heldRef.current = binding.heldNotices ?? binding.notices;
  const [saveFailed, setSaveFailed] = useState(false);
  /** Old runs whose `left` write failed; the banner stays on until they are marked. */
  const leftFailures = useRef<Set<string>>(new Set());
  const [released, setReleased] = useState({ session: 0, length: 0 });
  const [lockState, setLockState] = useState<RunLockState>('single-tab');
  /** True from a takeover until its restore has finished, so stale events are not written. */
  const [restoring, setRestoring] = useState(false);

  const runSetup = useCallback(
    async (runId: string): Promise<StorageResult<true>> => {
      const crypt = built.current;
      if (crypt === null) return storageError('write-failed');
      const bundle = { manifest: crypt.manifest, content: crypt.content };
      const saved = await saveCrypt(factory, {
        bundle,
        source: crypt.source === 'notes' ? 'generated' : 'sample',
        ...(crypt.documentDigest === undefined ? {} : { documentDigest: crypt.documentDigest }),
      });
      if (!saved.ok) return saved;
      const run = await createRun(factory, {
        runId,
        manifestId: crypt.manifest.manifestId,
        settings: settingsOf(crypt),
        createdAt: now(),
      });
      return run.ok ? { ok: true, value: true } : run;
    },
    [factory, now],
  );

  const makeWriter = useCallback(
    (runId: string, getSetup: () => Promise<StorageResult<true>>): EventWriter =>
      createEventWriter({
        factory,
        runId,
        append: async (f, id, event) => {
          const ready = await getSetup();
          return ready.ok ? appendEvent(f, id, event) : ready;
        },
      }),
    [factory],
  );

  const makeSession = useCallback((runId: string, setup: Promise<StorageResult<true>>, enqueued: number): Session => {
    sessionCount.current += 1;
    // The crypt and the run exist before the first append (or the append reports why not).
    const setupRef: { current: Promise<StorageResult<true>> } = { current: setup };
    const writer = makeWriter(runId, () => setupRef.current);
    // The lock is requested before the first append; the effect below enqueues only once it is held.
    const id = sessionCount.current;
    return newSession({
      id,
      runId,
      writer,
      setupRef,
      enqueued,
      locks,
      channelFactory,
      onLockState: setLockState,
      isCurrent: () => sessionCount.current === id,
    });
  }, [makeWriter, locks, channelFactory]);

  const beginSession = useCallback((): Session => {
    const runId = newRunId();
    return makeSession(runId, runSetup(runId), 0);
  }, [newRunId, runSetup, makeSession]);

  const bindingRestoreAction = binding.restore;
  /** Continues a stored run: it gets a lock and a writer, and its stored events are not written again. */
  const adoptRestored = useCallback(
    (restored: RestoredRun): void => {
      session.current?.unsubscribe();
      session.current?.lock.release();
      const ready: Promise<StorageResult<true>> = Promise.resolve({ ok: true, value: true });
      const next = makeSession(restored.run.runId, ready, restored.events.length);
      session.current = next;
      pendingStart.current = false;
      setReleased({ session: next.id, length: restored.events.length });
      setSaveFailed(leftFailures.current.size > 0);
      bindingRestoreAction?.(restored);
    },
    [makeSession, bindingRestoreAction],
  );

  const settle = useCallback(
    (current: Session, length: number, outcome: WriteOutcome): void => {
      if (outcome.status === 'failed') setSaveFailed(true);
      else if (
        outcome.status === 'saved' &&
        current.writer.unsaved().length === 0 &&
        leftFailures.current.size === 0
      )
        setSaveFailed(false);
      if (session.current !== current) return;
      setReleased((prev) =>
        prev.session === current.id && prev.length >= length ? prev : { session: current.id, length },
      );
      animate?.(heldRef.current);
    },
    [animate],
  );

  const enqueue = useCallback(
    (current: Session, event: Event, length: number): void => {
      current.enqueued = length;
      void current.writer.enqueue(event).then((outcome) => settle(current, length, outcome));
    },
    [settle],
  );

  const log = binding.eventLog;
  useEffect(() => {
    if (log.length === 0) return;
    if (pendingStart.current) {
      pendingStart.current = false;
      // A new run gets its own lock; the old one is released.
      session.current?.unsubscribe();
      session.current?.lock.release();
      session.current = beginSession();
      setSaveFailed(leftFailures.current.size > 0);
    }
    const current = session.current;
    if (current === null) return;
    // Nothing is written unless this tab owns the run. In-flight writes may finish (Req 9.4).
    if (restoring || !canWrite(current.lock.state)) return;
    // React may batch several accepted events into one render: enqueue each new one, in order.
    for (let index = current.enqueued; index < log.length; index += 1) {
      const event = log[index];
      if (event !== undefined) enqueue(current, event, index + 1);
    }
  }, [log, beginSession, enqueue, lockState, restoring]);

  // Release the lock when the screen goes away.
  useEffect(
    () => () => {
      session.current?.unsubscribe();
      session.current?.lock.release();
    },
    [],
  );

  const bindingRestore = binding.restore;
  const takeOver = useCallback(async (): Promise<void> => {
    const current = session.current;
    if (current === null) return;
    setRestoring(true);
    try {
      await current.lock.takeOver();
      if (!canWrite(current.lock.state)) return;
      setLockState(current.lock.state);
      const restored = await restoreRun(
        { factory, notesStore: notesStoreOption ?? createIdbStore(factory) },
        current.runId,
      );
      if (!restored.ok || session.current !== current) return;
      current.setup = Promise.resolve({ ok: true, value: true });
      current.writer = makeWriter(current.runId, () => current.setup);
      current.enqueued = restored.value.events.length;
      bindingRestore?.(restored.value);
      setReleased({ session: current.id, length: restored.value.events.length });
    } finally {
      setRestoring(false);
    }
  }, [factory, notesStoreOption, makeWriter, bindingRestore]);

  const status = binding.state?.status;
  useEffect(() => {
    const current = session.current;
    if (status !== 'escaped' || current === null || current.escapedSent) return;
    current.escapedSent = true;
    void current.setup
      .then((ready) => (ready.ok ? setRunStatus(factory, current.runId, 'escaped') : ready))
      .then((result) => {
        if (!result.ok) setSaveFailed(true);
      });
  }, [status, factory]);

  const bindingDispatch = binding.dispatch;
  const dispatch = useCallback(
    (action: RoomAction): void => {
      if (action.type === 'startRun' || action.type === 'playAgain') {
        const old = session.current;
        if (old !== null) {
          // The previous run is left; its stored events stay as they are.
          // A failed write leaves it `active`, so it is a save failure: show the banner, never block.
          void old.setup
            .then((ready) => (ready.ok ? setRunStatus(factory, old.runId, 'left') : ready))
            .then((result) => {
              if (result.ok) return;
              leftFailures.current.add(old.runId);
              setSaveFailed(true);
            });
        }
        pendingStart.current = true;
      }
      bindingDispatch(action);
    },
    [bindingDispatch, factory],
  );

  const retrySave = useCallback((): void => {
    const failedLeft = [...leftFailures.current];
    for (const runId of failedLeft) {
      void setRunStatus(factory, runId, 'left').then((result) => {
        if (!result.ok) return;
        leftFailures.current.delete(runId);
        const live = session.current;
        if (leftFailures.current.size === 0 && (live === null || live.writer.unsaved().length === 0)) {
          setSaveFailed(false);
        }
      });
    }
    const current = session.current;
    if (current === null) return;
    current.setup = runSetup(current.runId);
    void current.writer.retry().then((outcome) => {
      if (
        outcome.status === 'saved' &&
        current.writer.unsaved().length === 0 &&
        leftFailures.current.size === 0
      )
        setSaveFailed(false);
    });
  }, [runSetup, factory]);

  const current = session.current;
  const open = current === null || (released.session === current.id && released.length >= log.length);
  return {
    ...binding,
    dispatch,
    heldNotices: binding.heldNotices ?? binding.notices,
    notices: open ? binding.notices : [],
    saveFailed,
    retrySave,
    ...(current === null ? {} : { runId: current.runId }),
    lockState,
    takeOver,
    restore: adoptRestored,
  };
}

/** The persisted binding with browser defaults, shaped like `useRoomBinding`. */
export function usePersistedRoomBinding(buildCrypt: BuildCrypt): RoomBinding {
  return usePersistedRoom(buildCrypt);
}
