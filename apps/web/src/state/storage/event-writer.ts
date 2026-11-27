import type { Event } from '@escape-the-crypt/core';
import { appendEvent } from './run-repository';
import { storageError } from './storage-error';
import type { StorageError, StorageResult } from './storage-error';

export type WriteOutcome =
  | { status: 'saved'; seq: number }
  | { status: 'failed'; error: StorageError }
  | { status: 'skipped' }; // queued behind an earlier failure

export interface EventWriter {
  /** Resolves when this event's attempt settles. Never rejects. */
  enqueue(event: Event): Promise<WriteOutcome>;
  /** Re-attempts the oldest unsaved event, then drains the rest in order. Never rejects. */
  retry(): Promise<WriteOutcome>;
  /** Events not yet stored, oldest first. */
  readonly unsaved: () => readonly Event[];
}

export type AppendFn = (
  factory: IDBFactory | undefined,
  runId: string,
  event: Event,
) => Promise<StorageResult<{ seq: number }>>;

export interface EventWriterOptions {
  readonly factory: IDBFactory | undefined;
  readonly runId: string;
  /** Defaults to the repository's `appendEvent`. */
  readonly append?: AppendFn;
}

/**
 * One serial write queue per run. After a failed append the writer is blocked: later events stay
 * in memory in order and resolve `skipped` until a retry stores the failed one (8.5, 8.6).
 */
export function createEventWriter(options: EventWriterOptions): EventWriter {
  const append = options.append ?? appendEvent;
  // The oldest entry is the failed or in-flight event.
  const unsaved: Event[] = [];
  // Not blocked up front: with no factory the first attempt must report `failed` so the banner shows.
  let blocked = false;
  let chain: Promise<unknown> = Promise.resolve();

  const attempt = async (event: Event): Promise<WriteOutcome> => {
    try {
      const result = await append(options.factory, options.runId, event);
      if (result.ok) return { status: 'saved', seq: result.value.seq };
      return { status: 'failed', error: result.error };
    } catch {
      return { status: 'failed', error: storageError('write-failed').error };
    }
  };

  const storeOldest = async (): Promise<WriteOutcome> => {
    const oldest = unsaved[0];
    if (oldest === undefined) return { status: 'skipped' };
    if (options.factory === undefined) {
      blocked = true;
      return { status: 'failed', error: storageError('storage-unavailable').error };
    }
    const outcome = await attempt(oldest);
    if (outcome.status === 'saved') unsaved.shift();
    else blocked = true;
    return outcome;
  };

  const schedule = (task: () => Promise<WriteOutcome>): Promise<WriteOutcome> => {
    const run = chain.then(async (): Promise<WriteOutcome> => {
      try {
        return await task();
      } catch {
        blocked = true;
        return { status: 'failed', error: storageError('write-failed').error };
      }
    });
    chain = run;
    return run;
  };

  return {
    enqueue: (event) => {
      unsaved.push(event);
      return schedule(async () => {
        if (blocked) return { status: 'skipped' };
        return storeOldest();
      });
    },
    retry: () =>
      schedule(async () => {
        if (unsaved.length === 0) return { status: 'skipped' };
        blocked = false;
        const first = await storeOldest();
        if (first.status !== 'saved') return first;
        while (unsaved.length > 0) {
          const next = await storeOldest();
          if (next.status !== 'saved') break;
        }
        return first;
      }),
    unsaved: () => [...unsaved],
  };
}
