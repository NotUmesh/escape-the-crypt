import {
  cryptTargetFor,
  runRoomPipeline,
  type BudgetLedger,
  type PipelineJobError,
  type PipelineJobFailure,
  type PipelineOptions,
  type PipelineResult,
  type Provider,
} from '@escape-the-crypt/core';
import type { Job, JobFailureKind, JobStore } from '../jobs/job-store';
import type { Logger } from './respond';

type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export type RunPipeline = (
  notesText: string,
  options: PipelineOptions,
) => Promise<Result<PipelineResult, PipelineJobFailure>>;

/** Pipeline settings the caller chooses: model ID, temperature, limits, `costOf`, `worstCaseUsd`. */
export type PipelineSettings = Omit<PipelineOptions, 'provider' | 'ledger' | 'providerName' | 'now'>;

export interface JobRunnerDeps {
  readonly jobStore: JobStore;
  readonly provider: Provider;
  readonly providerName: string;
  readonly ledger: BudgetLedger;
  readonly pipelineSettings: PipelineSettings;
  readonly now: () => number;
  readonly logger: Logger;
  /** Defaults to core's `runRoomPipeline`. Injectable so tests can count calls. */
  readonly runPipeline?: RunPipeline;
  /** One `AbortController` per running job, keyed by job ID. Owned by the server. */
  readonly controllers?: Map<string, AbortController>;
}

/** Maps a pipeline error to the learner-visible failure kind. */
export function mapFailure(error: PipelineJobError): JobFailureKind {
  switch (error.kind) {
    case 'budget-exhausted':
      return 'budget-exhausted';
    case 'cancelled':
      return 'cancelled';
    case 'empty-room':
    case 'input-too-long':
      return 'not-enough-material';
    default:
      return 'generation-failed';
  }
}

/**
 * Runs one job to a terminal status. Never rejects: any thrown value becomes
 * `generation-failed`, and only the error's type name is logged.
 */
export async function runJob(deps: JobRunnerDeps, job: Job): Promise<void> {
  const started = deps.now();
  const run = deps.runPipeline ?? runRoomPipeline;
  const controller = new AbortController();
  deps.controllers?.set(job.id, controller);
  try {
    deps.jobStore.setStatus(job.id, 'running');
    if (job.notesText === null) {
      deps.jobStore.setStatus(job.id, 'failed', { failure: 'generation-failed' });
      deps.logger.error({ event: 'job', status: 'failed', failure: 'generation-failed', errorType: 'missing-notes' });
      return;
    }
    const result = await run(job.notesText, {
      ...deps.pipelineSettings,
      target: cryptTargetFor(job.runLength),
      provider: deps.provider,
      providerName: deps.providerName,
      ledger: deps.ledger,
      now: deps.now,
      signal: controller.signal,
    });
    if (result.ok) {
      // If a cancel was requested, the store discards this result and ends the job `cancelled`.
      deps.jobStore.setStatus(job.id, 'completed', { result: result.value });
      const counts = result.value.metadata.counts;
      deps.logger.info({
        event: 'job',
        status: controller.signal.aborted ? 'cancelled' : 'completed',
        durationMs: deps.now() - started,
        concepts: counts.concepts,
        accepted: counts.accepted,
        discarded: counts.discarded,
        calls: result.value.metadata.calls.length,
      });
      return;
    }
    const failure = mapFailure(result.error.error);
    const finalStatus = failure === 'cancelled' ? 'cancelled' : 'failed';
    deps.jobStore.setStatus(job.id, finalStatus, { failure });
    deps.logger.info({
      event: 'job',
      status: finalStatus,
      failure,
      errorKind: result.error.error.kind,
      durationMs: deps.now() - started,
      calls: result.error.metadata.calls.length,
    });
  } catch (error: unknown) {
    const errorType = error instanceof Error ? error.constructor.name : typeof error;
    try {
      deps.jobStore.setStatus(job.id, 'failed', { failure: 'generation-failed' });
      deps.logger.error({
        event: 'job',
        status: 'failed',
        failure: 'generation-failed',
        errorType,
        durationMs: deps.now() - started,
      });
    } catch {
      // Nothing else can be done; the sweep fails a stuck job after MAX_RUN_MS.
    }
  } finally {
    deps.controllers?.delete(job.id);
  }
}
