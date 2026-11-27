import type { CryptBundle, GenerationFailureKind } from '@escape-the-crypt/core';
import type { JobState } from './worker-client';

/** The generation flow as the learner sees it. Holds no notes text and no job body. */
export type GenerationState =
  | { readonly status: 'idle' }
  | { readonly status: 'starting'; readonly key: string }
  | { readonly status: 'polling'; readonly key: string; readonly jobId: string }
  | { readonly status: 'ready'; readonly bundle: CryptBundle }
  | { readonly status: 'failed'; readonly kind: GenerationFailureKind }
  | { readonly status: 'cancelled' };

export type GenerationEvent =
  /** A new press of the generate button, with a fresh idempotency key. */
  | { readonly type: 'press'; readonly key: string }
  | { readonly type: 'started'; readonly jobId: string }
  /** Network, timeout, not-found, rejected and invalid-response all read as generation-failed. */
  | { readonly type: 'startFailed' }
  | { readonly type: 'polled'; readonly job: JobState }
  | { readonly type: 'pollFailed' }
  | { readonly type: 'capReached' }
  | { readonly type: 'bundleRejected' }
  | { readonly type: 'cancel' };

/** Poll errors of these kinds are tolerated, this many in a row. The next one fails the job. */
export const MAX_TOLERATED_POLL_ERRORS = 3;
const TOLERATED_KINDS: readonly string[] = ['network', 'timeout'];

/**
 * The count of consecutive tolerated poll errors after one more error of this kind, or null when the
 * job should fail now. Other kinds fail at once. Any successful poll resets the count to 0 (caller).
 */
export function countPollError(consecutive: number, kind: string): number | null {
  if (!TOLERATED_KINDS.includes(kind)) return null;
  return consecutive < MAX_TOLERATED_POLL_ERRORS ? consecutive + 1 : null;
}

export const INITIAL_GENERATION: GenerationState = { status: 'idle' };

/** True while a job is being started or polled. */
export function isGenerating(state: GenerationState): boolean {
  return state.status === 'starting' || state.status === 'polling';
}

function failed(kind: GenerationFailureKind): GenerationState {
  return { status: 'failed', kind };
}

function afterPoll(state: Extract<GenerationState, { status: 'polling' }>, job: JobState): GenerationState {
  switch (job.kind) {
    case 'queued':
    case 'running':
      return state;
    case 'completed':
      return { status: 'ready', bundle: job.bundle };
    case 'failed':
      return failed(job.failure);
    case 'expired':
      return failed('expired');
    case 'cancelled':
      return { status: 'cancelled' };
  }
}

/** Pure reducer. An event that does not fit the current status leaves the state unchanged. */
export function generationReducer(state: GenerationState, event: GenerationEvent): GenerationState {
  switch (event.type) {
    case 'press':
      return state.status === 'idle' || state.status === 'failed' || state.status === 'cancelled'
        ? { status: 'starting', key: event.key }
        : state;
    case 'started':
      return state.status === 'starting' ? { status: 'polling', key: state.key, jobId: event.jobId } : state;
    case 'startFailed':
      return state.status === 'starting' ? failed('generation-failed') : state;
    case 'polled':
      return state.status === 'polling' ? afterPoll(state, event.job) : state;
    case 'pollFailed':
      return state.status === 'polling' ? failed('generation-failed') : state;
    case 'capReached':
    case 'bundleRejected':
      return state.status === 'polling' ? failed('generation-failed') : state;
    case 'cancel':
      // The job ID is dropped with the state. No request is made.
      return isGenerating(state) ? { status: 'cancelled' } : state;
  }
}
