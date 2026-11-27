import type { Outcome_Notice } from '@escape-the-crypt/core';
import type { NotesStore } from '../features/ingest/notes-store';
import type { EventWriter } from './storage/event-writer';
import type { BroadcastChannelLike, LockManagerLike, RunLock, RunLockState } from './storage/run-lock';
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

export interface Session {
  readonly id: number;
  readonly runId: string;
  /** Replaced by a fresh writer after a takeover restore. */
  writer: EventWriter;
  readonly lock: RunLock;
  readonly unsubscribe: () => void;
  /** Replaced by a retry, so a failed crypt save or run creation is attempted again. */
  setup: Promise<StorageResult<true>>;
  // (accessor-backed, see beginSession)
  enqueued: number;
  escapedSent: boolean;
}

export const browserFactory = (): IDBFactory | undefined =>
  typeof indexedDB === 'undefined' ? undefined : indexedDB;

export const browserLocks = (): LockManagerLike | undefined =>
  typeof navigator === 'undefined' || !('locks' in navigator) || navigator.locks === undefined
    ? undefined
    : (navigator.locks as unknown as LockManagerLike);

export const browserChannelFactory = (): ((name: string) => BroadcastChannelLike) | undefined =>
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : (name) => new BroadcastChannel(name) as unknown as BroadcastChannelLike;

/** Writes are allowed only while this tab owns the run (Req 9.1, 9.2). */
export const canWrite = (state: RunLockState): boolean => state === 'held' || state === 'single-tab';
