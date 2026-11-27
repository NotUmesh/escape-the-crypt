import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { SampleCryptResult } from '@escape-the-crypt/core';
import { countPollError, generationReducer, INITIAL_GENERATION } from './generation-flow';
import type { GenerationState } from './generation-flow';
import { buildGeneratedCrypt } from './generated-crypt';
import type { WorkerClient } from './worker-client';

export const POLL_INTERVAL_MS = 2000;
/** About five minutes at the default interval. Reaching it counts as generation-failed. */
export const MAX_POLLS = 150;
/** Extra tries of the first request after a network or timeout error. */
export const START_RETRIES = 2;

export interface GenerationOptions {
  readonly client: WorkerClient;
  readonly intervalMs?: number;
  readonly maxPolls?: number;
  readonly startRetries?: number;
  /** A fresh idempotency key. One per press of the button. */
  readonly newKey?: () => string;
}

export interface Generation {
  readonly state: GenerationState;
  /** Starts a job for this notes text. Ignored while one is running. */
  readonly start: (notesText: string) => void;
  /** Stops polling and drops the job ID. Sends no request. */
  readonly cancel: () => void;
  /** The playable crypt of a `ready` state, with the chunks of the text that was sent. */
  readonly crypt: () => (SampleCryptResult & { readonly source: 'notes' }) | null;
}

function randomKey(): string {
  return globalThis.crypto.randomUUID();
}

export function useGeneration(options: GenerationOptions): Generation {
  const [state, send] = useReducer(generationReducer, INITIAL_GENERATION);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The id of the run that may still act. Cancel, completion and unmount set it to null.
  const liveRun = useRef<number | null>(null);
  const runCounter = useRef(0);
  const sleeper = useRef<{ timer: ReturnType<typeof setTimeout>; wake: () => void } | null>(null);
  const built = useRef<ReturnType<Generation['crypt']>>(null);

  const stop = useCallback((): void => {
    liveRun.current = null;
    const pending = sleeper.current;
    sleeper.current = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.wake();
    }
  }, []);

  useEffect(() => stop, [stop]);

  const sleep = useCallback(
    (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          sleeper.current = null;
          resolve();
        }, ms);
        sleeper.current = { timer, wake: resolve };
      }),
    [],
  );

  const drive = useCallback(
    async (run: number, notesText: string, key: string): Promise<void> => {
      const { client, intervalMs = POLL_INTERVAL_MS, maxPolls = MAX_POLLS, startRetries = START_RETRIES } =
        optionsRef.current;
      const alive = (): boolean => liveRun.current === run;
      const finish = (event: Parameters<typeof send>[0]): void => {
        liveRun.current = null;
        send(event);
      };
      let jobId: string | null = null;
      for (let attempt = 0; jobId === null; attempt += 1) {
        // The same key every time, so a retried POST cannot start a second job.
        const started = await client.startJob(notesText, key);
        if (!alive()) return;
        if (started.ok) {
          jobId = started.value.jobId;
        } else if ((started.error.kind === 'network' || started.error.kind === 'timeout') && attempt < startRetries) {
          await sleep(intervalMs);
          if (!alive()) return;
        } else {
          finish({ type: 'startFailed' });
          return;
        }
      }
      send({ type: 'started', jobId });
      let pollErrors = 0;
      for (let polls = 0; polls < maxPolls; polls += 1) {
        await sleep(intervalMs);
        if (!alive()) return;
        const result = await client.getJob(jobId);
        if (!alive()) return;
        if (!result.ok) {
          // A tolerated error still uses up one poll of the cap.
          const counted = countPollError(pollErrors, result.error.kind);
          if (counted === null) {
            finish({ type: 'pollFailed' });
            return;
          }
          pollErrors = counted;
          continue;
        }
        pollErrors = 0;
        const job = result.value;
        if (job.kind === 'completed') {
          const crypt = buildGeneratedCrypt(job.bundle, notesText);
          if (!crypt.ok) {
            finish({ type: 'bundleRejected' });
            return;
          }
          built.current = crypt.value;
        }
        if (job.kind !== 'queued' && job.kind !== 'running') {
          finish({ type: 'polled', job });
          return;
        }
        send({ type: 'polled', job });
      }
      finish({ type: 'capReached' });
    },
    [sleep],
  );

  const start = useCallback(
    (notesText: string): void => {
      if (liveRun.current !== null) return;
      const key = (optionsRef.current.newKey ?? randomKey)();
      runCounter.current += 1;
      liveRun.current = runCounter.current;
      built.current = null;
      send({ type: 'press', key });
      void drive(runCounter.current, notesText, key);
    },
    [drive],
  );

  const cancel = useCallback((): void => {
    stop();
    send({ type: 'cancel' });
  }, [stop]);

  const crypt = useCallback(() => built.current, []);

  return { state, start, cancel, crypt };
}
