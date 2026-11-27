import type { Session } from './persisted-room-support';
import type { EventWriter } from './storage/event-writer';
import { acquireRunLock } from './storage/run-lock';
import type { BroadcastChannelLike, LockManagerLike, RunLockState } from './storage/run-lock';
import type { StorageResult } from './storage/storage-error';

export interface NewSessionInput {
  readonly id: number;
  readonly runId: string;
  readonly writer: EventWriter;
  /** Read and replaced through the session, so a retry can swap the setup promise. */
  readonly setupRef: { current: Promise<StorageResult<true>> };
  readonly enqueued: number;
  readonly locks: LockManagerLike | undefined;
  readonly channelFactory: ((name: string) => BroadcastChannelLike) | undefined;
  /** Called with lock state changes while this session is the current one. */
  readonly onLockState: (state: RunLockState) => void;
  readonly isCurrent: () => boolean;
}

/** Builds a session around a run lock. The lock is requested before the first append. */
export function newSession(input: NewSessionInput): Session {
  const { id, runId, writer, setupRef, enqueued, locks, channelFactory, onLockState, isCurrent } = input;
  const lock = acquireRunLock({ locks, channelFactory }, runId);
  const unsubscribe = lock.subscribe((next) => {
    if (isCurrent()) onLockState(next);
  });
  onLockState(lock.state);
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
    enqueued,
    escapedSent: false,
  };
}
