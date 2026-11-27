import { ackBody } from './worker-bodies';
import type { JobState, StartedJob, WorkerClient, WorkerError, WorkerResult } from '../features/generate/worker-client';

export interface FakeWorker {
  readonly client: WorkerClient;
  /** Idempotency keys, one per `startJob` call. */
  readonly startKeys: string[];
  /** Notes text per `startJob` call. */
  readonly startTexts: string[];
  /** Job ids, one per `getJob` call. */
  readonly polls: string[];
  /** Job ids, one per cancelJob call. */
  readonly cancels: string[];
}

type StartStep = WorkerError | 'ok';
type PollStep = JobState | WorkerError;

const JOB_KINDS = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'expired']);

function isJob(step: PollStep): step is JobState {
  return JOB_KINDS.has(step.kind);
}

/**
 * A scripted client. Each call takes the next step; the last step repeats.
 * `starts` default to one success.
 */
export function fakeWorker(polls: readonly PollStep[], starts: readonly StartStep[] = ['ok']): FakeWorker {
  const startKeys: string[] = [];
  const startTexts: string[] = [];
  const pollLog: string[] = [];
  const cancelLog: string[] = [];
  const next = <T,>(steps: readonly T[], count: number): T => steps[Math.min(count, steps.length - 1)] as T;
  const client: WorkerClient = {
    startJob(notesText, key): Promise<WorkerResult<StartedJob>> {
      const step = next(starts, startKeys.length);
      startKeys.push(key);
      startTexts.push(notesText);
      return Promise.resolve(step === 'ok' ? { ok: true, value: ackBody('queued') } : { ok: false, error: step });
    },
    getJob(jobId): Promise<WorkerResult<JobState>> {
      const step = next(polls, pollLog.length);
      pollLog.push(jobId);
      return Promise.resolve(isJob(step) ? { ok: true, value: step } : { ok: false, error: step });
    },
    cancelJob(jobId): void {
      cancelLog.push(jobId);
    },
  };
  return { client, startKeys, startTexts, polls: pollLog, cancels: cancelLog };
}
