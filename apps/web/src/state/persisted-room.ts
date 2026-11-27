import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event, Outcome_Notice } from '@escape-the-crypt/core';
import type { RoomAction } from './room-actions';
import { RUN_SETTINGS, useRoomBinding } from './room-binding';
import type { BuildCrypt, BuiltCrypt, RoomBinding } from './room-binding';
import { saveCrypt } from './storage/crypt-repository';
import { createEventWriter } from './storage/event-writer';
import type { EventWriter, WriteOutcome } from './storage/event-writer';
import { appendEvent, createRun, setRunStatus } from './storage/run-repository';
import { restoreRun } from './storage/restore-run';
import { acquireRunLock } from './storage/run-lock';
import type { BroadcastChannelLike, LockManagerLike, RunLockState } from './storage/run-lock';
import { browserChannelFactory, browserFactory, browserLocks, canWrite } from './persisted-room-support';
import type { Session } from './persisted-room-support';
import { createIdbStore } from '../features/ingest/notes-store-idb';
import type { NotesStore } from '../features/ingest/notes-store';
import { storageError } from './storage/storage-error';
import type { StorageResult } from './storage/storage-error';

export interface PersistedRoomOptions {
  /** Defaults to the browser's `indexedDB`; undefined means nothing can be saved. */
  readonly factory?: IDBFactory | undefined;
  readonly now?: () => number;
  readonly newRunId?: () => string;
  /** Web Locks manager for the run lock. Defaults to `navigator.locks` when present. */
  readonly locks?: LockManagerLike | undefined;
  /** BroadcastChannel fallback for the run lock. Defaults to the global when present. */
  readonly channelFactory?: ((name: string) => BroadcastChannelLike) | undefined;
  /** Notes store used by a takeover restore. Defaults to the IndexedDB adapter. */
  readonly notesStore?: NotesStore;
  /** Called once per accepted Event, with its notices, after its append has settled. */
  readonly animate?: (notices: readonly Outcome_Notice[]) => void;
}

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
        settings: RUN_SETTINGS,
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

  const beginSession = useCallback((): Session => {
    const runId = newRunId();
    sessionCount.current += 1;
    // The crypt and the run exist before the first append (or the append reports why not).
    const setupRef: { current: Promise<StorageResult<true>> } = { current: runSetup(runId) };
    const writer = makeWriter(runId, () => setupRef.current);
    // The lock is requested before the first append; the effect below enqueues only once it is held.
    const lock = acquireRunLock({ locks, channelFactory }, runId);
    const id = sessionCount.current;
    const unsubscribe = lock.subscribe((next) => {
      if (sessionCount.current === id) setLockState(next);
    });
    setLockState(lock.state);
    return {
      id,
      runId,
      writer,
      lock,
      unsubscribe,
      get setup() {
        return setupRef.current;
      },
      set setup(next: Promise<StorageResult<true>>) {
        setupRef.current = next;
      },
      enqueued: 0,
      escapedSent: false,
    };
  }, [factory, newRunId, runSetup, makeWriter, locks, channelFactory]);

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
  };
}

/** The persisted binding with browser defaults, shaped like `useRoomBinding`. */
export function usePersistedRoomBinding(buildCrypt: BuildCrypt): RoomBinding {
  return usePersistedRoom(buildCrypt);
}
