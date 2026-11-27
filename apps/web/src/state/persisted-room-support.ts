import type { EventWriter } from './storage/event-writer';
import type { BroadcastChannelLike, LockManagerLike, RunLock, RunLockState } from './storage/run-lock';
import type { StorageResult } from './storage/storage-error';

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
