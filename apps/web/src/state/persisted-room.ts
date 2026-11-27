import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event, Outcome_Notice } from '@escape-the-crypt/core';
import type { RoomAction } from './room-actions';
import { RUN_SETTINGS, useRoomBinding } from './room-binding';
import type { BuildCrypt, BuiltCrypt, RoomBinding } from './room-binding';
import { saveCrypt } from './storage/crypt-repository';
import { createEventWriter } from './storage/event-writer';
import type { EventWriter, WriteOutcome } from './storage/event-writer';
import { appendEvent, createRun, setRunStatus } from './storage/run-repository';
import { storageError } from './storage/storage-error';
import type { StorageResult } from './storage/storage-error';

export interface PersistedRoomOptions {
  /** Defaults to the browser's `indexedDB`; undefined means nothing can be saved. */
  readonly factory?: IDBFactory | undefined;
  readonly now?: () => number;
  readonly newRunId?: () => string;
  /** Reserved for the run lock (phase 3). Not used yet. */
  readonly locks?: unknown;
  /** Reserved for the run lock fallback (phase 3). Not used yet. */
  readonly channelFactory?: unknown;
  /** Called once per accepted Event, with its notices, after its append has settled. */
  readonly animate?: (notices: readonly Outcome_Notice[]) => void;
}

interface Session {
  readonly id: number;
  readonly runId: string;
  readonly writer: EventWriter;
  /** Replaced by a retry, so a failed crypt save or run creation is attempted again. */
  setup: Promise<StorageResult<true>>;
  // (accessor-backed, see beginSession)
  enqueued: number;
  escapedSent: boolean;
}

const browserFactory = (): IDBFactory | undefined =>
  typeof indexedDB === 'undefined' ? undefined : indexedDB;

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
  const [released, setReleased] = useState({ session: 0, length: 0 });

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

  const beginSession = useCallback((): Session => {
    const runId = newRunId();
    sessionCount.current += 1;
    // The crypt and the run exist before the first append (or the append reports why not).
    const setupRef: { current: Promise<StorageResult<true>> } = { current: runSetup(runId) };
    const writer = createEventWriter({
      factory,
      runId,
      append: async (f, id, event) => {
        const ready = await setupRef.current;
        return ready.ok ? appendEvent(f, id, event) : ready;
      },
    });
    return {
      id: sessionCount.current,
      runId,
      writer,
      get setup() {
        return setupRef.current;
      },
      set setup(next: Promise<StorageResult<true>>) {
        setupRef.current = next;
      },
      enqueued: 0,
      escapedSent: false,
    };
  }, [factory, newRunId, runSetup]);

  const settle = useCallback(
    (current: Session, length: number, outcome: WriteOutcome): void => {
      if (outcome.status === 'failed') setSaveFailed(true);
      else if (outcome.status === 'saved' && current.writer.unsaved().length === 0) setSaveFailed(false);
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
      const current = beginSession();
      session.current = current;
      setSaveFailed(false);
      log.forEach((event, index) => enqueue(current, event, index + 1));
      return;
    }
    const current = session.current;
    if (current === null) return;
    // React may batch several accepted events into one render: enqueue each new one, in order.
    for (let index = current.enqueued; index < log.length; index += 1) {
      const event = log[index];
      if (event !== undefined) enqueue(current, event, index + 1);
    }
  }, [log, beginSession, enqueue]);

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
          void old.setup.then((ready) => (ready.ok ? setRunStatus(factory, old.runId, 'left') : ready));
        }
        pendingStart.current = true;
      }
      bindingDispatch(action);
    },
    [bindingDispatch, factory],
  );

  const retrySave = useCallback((): void => {
    const current = session.current;
    if (current === null) return;
    current.setup = runSetup(current.runId);
    void current.writer.retry().then((outcome) => {
      if (outcome.status === 'saved' && current.writer.unsaved().length === 0) setSaveFailed(false);
    });
  }, [runSetup]);

  const current = session.current;
  const open = current === null || (released.session === current.id && released.length >= log.length);
  return {
    ...binding,
    dispatch,
    heldNotices: binding.heldNotices ?? binding.notices,
    notices: open ? binding.notices : [],
    saveFailed,
    retrySave,
  };
}

/** The persisted binding with browser defaults, shaped like `useRoomBinding`. */
export function usePersistedRoomBinding(buildCrypt: BuildCrypt): RoomBinding {
  return usePersistedRoom(buildCrypt);
}
