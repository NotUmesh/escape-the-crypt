import { useCallback, useEffect, useReducer, useRef } from 'react';
import { countPollError, generationReducer, INITIAL_GENERATION } from './generation-flow';
import type { GenerationState } from './generation-flow';
import { buildGeneratedCrypt } from './generated-crypt';
import type { GeneratedCrypt } from './generated-crypt';
import type { WorkerClient } from './worker-client';
import type { RunSettings } from '@escape-the-crypt/core';
import { RUN_SETTINGS } from '../../state/room-binding';

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
  /**
   * Starts a job for this notes text. Ignored while one is running. `settings` (default Short and
   * Apprentice) sends its length to the worker and travels on the crypt the job builds.
   */
  readonly start: (notesText: string, documentDigest?: string, settings?: RunSettings) => void;
  /** Stops polling, drops the job ID and asks the worker to stop the job (once, fire-and-forget). */
  readonly cancel: () => void;
  /** The playable crypt of a `ready` state, with the chunks of the text that was sent. */
  readonly crypt: () => GeneratedCrypt | null;
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

  // The job the worker knows about while this hook polls it. Null before the POST returns and after any end.
  const activeJob = useRef<string | null>(null);
  // Job IDs a DELETE was already sent for: at most one per job.
  const deleted = useRef(new Set<string>());
  // Runs left (cancel or unmount) before their POST returned a job ID.
  const abandoned = useRef(new Set<number>());
  const sendDelete = useCallback((jobId: string): void => {
    if (deleted.current.has(jobId)) return;
    deleted.current.add(jobId);
    optionsRef.current.client.cancelJob(jobId);
  }, []);
  /** Stops the run for good and tells the worker when a job is in flight. */
  const abandon = useCallback((): void => {
    const jobId = activeJob.current;
    if (jobId !== null) sendDelete(jobId);
    else if (liveRun.current !== null) abandoned.current.add(liveRun.current);
    activeJob.current = null;
    stop();
  }, [sendDelete, stop]);
  useEffect(() => abandon, [abandon]);
  useEffect(() => {
    const onPageHide = (): void => {
      if (activeJob.current !== null) sendDelete(activeJob.current);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [sendDelete]);
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
    async (run: number, notesText: string, key: string, documentDigest: string | undefined, settings: RunSettings): Promise<void> => {
      const { client, intervalMs = POLL_INTERVAL_MS, maxPolls = MAX_POLLS, startRetries = START_RETRIES } =
        optionsRef.current;
      const alive = (): boolean => liveRun.current === run;
      const finish = (event: Parameters<typeof send>[0]): void => {
        liveRun.current = null;
        activeJob.current = null;
        send(event);
      };
      let jobId: string | null = null;
      for (let attempt = 0; jobId === null; attempt += 1) {
        // The same key every time, so a retried POST cannot start a second job.
        const started = await client.startJob(notesText, key, settings.length);
        if (!alive()) {
          // Cancelled while the POST was in flight: stop the job it started, and never poll it.
          if (started.ok && abandoned.current.delete(run)) sendDelete(started.value.jobId);
          return;
        }
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
      activeJob.current = jobId;
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
          const crypt = buildGeneratedCrypt(job.bundle, notesText, documentDigest, settings);
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
    [sendDelete, sleep],
  );

  const start = useCallback(
    (notesText: string, documentDigest?: string, settings: RunSettings = RUN_SETTINGS): void => {
      if (liveRun.current !== null) return;
      const key = (optionsRef.current.newKey ?? randomKey)();
      runCounter.current += 1;
      liveRun.current = runCounter.current;
      built.current = null;
      send({ type: 'press', key });
      void drive(runCounter.current, notesText, key, documentDigest, settings);
    },
    [drive],
  );

  const cancel = useCallback((): void => {
    abandon();
    send({ type: 'cancel' });
  }, [abandon]);

  const crypt = useCallback(() => built.current, []);

  return { state, start, cancel, crypt };
}
