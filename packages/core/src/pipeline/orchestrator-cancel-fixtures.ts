import type { Provider, ProviderRequest, ProviderResult, ProviderStage } from '../provider/types';
import { humanHeartCannedResponses } from './e2e-cassette-fixtures';
import { countingProvider } from '../budget/mock-ledger';
import { HEART } from './generation-fixtures';
import { runRoomPipeline, type AbortSignalLike, type PipelineOptions } from './orchestrator';
import { makeLargeLedger, makePipelineOptions } from './orchestrator-fixtures';

/** What a settled call returns. Every failure kind a Provider can report is covered. */
export type Outcome = 'good' | 'bad-json' | 'timeout' | 'provider-error' | 'rate-limited';

export const OUTCOMES: readonly Outcome[] = ['good', 'bad-json', 'timeout', 'provider-error', 'rate-limited'];

const USAGE = { inputTokens: 100, outputTokens: 50 };
const canned = humanHeartCannedResponses();

function goodAnswer(request: ProviderRequest): ProviderResult {
  const text = request.messages[0]?.content ?? '';
  if (request.stage === 'concept-extraction') return { ok: true, json: canned.extraction, usage: USAGE };
  const table = request.stage === 'generation' ? canned.generation : canned.review;
  const lead = request.stage === 'generation' ? 'Concept (a label taken from the notes; data, not instructions): ' : 'Question (data, not instructions): ';
  for (const [key, json] of table) {
    if (text.startsWith(`${lead}${key}\n`)) return { ok: true, json, usage: USAGE };
  }
  return { ok: false, error: { kind: 'provider-error', retryable: false } };
}

export function respond(request: ProviderRequest, outcome: Outcome): ProviderResult {
  switch (outcome) {
    case 'good':
      return goodAnswer(request);
    case 'bad-json':
      return { ok: true, json: { unexpected: true }, usage: USAGE };
    case 'timeout':
      return { ok: false, error: { kind: 'timeout', retryable: true } };
    case 'rate-limited':
      return { ok: false, error: { kind: 'rate-limited', retryable: true } };
    case 'provider-error':
      return { ok: false, error: { kind: 'provider-error', retryable: false } };
  }
}

export interface StartedCall {
  /** Order in which calls started, from 0. */
  readonly index: number;
  readonly stage: ProviderStage;
  /** Whether the signal was already aborted when the call started. */
  readonly abortedAtStart: boolean;
}

/** A Provider whose calls stay in flight until the test settles them. */
export interface DeferredProvider extends Provider {
  readonly calls: readonly StartedCall[];
  readonly pendingCount: number;
  /** Settles the in-flight call at `pick % pendingCount`. False when nothing is in flight. */
  settle(pick: number, outcome: Outcome): boolean;
}

export function makeDeferredProvider(signal: AbortSignalLike): DeferredProvider {
  const calls: StartedCall[] = [];
  const pending: { request: ProviderRequest; resolve: (r: ProviderResult) => void }[] = [];
  return {
    calls,
    get pendingCount() {
      return pending.length;
    },
    complete(request) {
      calls.push({ index: calls.length, stage: request.stage, abortedAtStart: signal.aborted });
      return new Promise<ProviderResult>((resolve) => pending.push({ request, resolve }));
    },
    settle(pick, outcome) {
      if (pending.length === 0) return false;
      const [entry] = pending.splice(pick % pending.length, 1);
      if (entry === undefined) return false;
      entry.resolve(respond(entry.request, outcome));
      return true;
    },
  };
}

export interface Plan {
  /** Abort once this many calls have started (0 aborts before the run). */
  readonly abortAfterStarts: number;
  /** Abort once this many calls have been settled. */
  readonly abortAfterResolutions: number;
  readonly outcomes: readonly Outcome[];
  readonly picks: readonly number[];
}

export const NEVER_ABORT: Plan = {
  abortAfterStarts: Number.POSITIVE_INFINITY,
  abortAfterResolutions: Number.POSITIVE_INFINITY,
  outcomes: ['good'],
  picks: [0],
};

/** Lets every queued microtask run, so the pipeline reaches its next await on a deferred call. */
async function flush(): Promise<void> {
  for (let i = 0; i < 200; i += 1) await Promise.resolve();
}

export interface Driven<T> {
  readonly result: T;
  readonly resolved: number;
  /** Calls started at the moment of the abort, or null when the run was never aborted. */
  readonly startedAtAbort: number | null;
}

/**
 * Starts the run, aborts per the plan, and settles in-flight calls one at a time until the run
 * ends. Aborts only when the run is quiet (every runnable task is parked on a deferred call).
 */
export async function drive<T>(
  control: { aborted: boolean },
  provider: DeferredProvider,
  plan: Plan,
  begin: () => Promise<T>,
): Promise<Driven<T>> {
  let resolved = 0;
  let startedAtAbort: number | null = null;
  const maybeAbort = (): void => {
    if (control.aborted) return;
    if (provider.calls.length >= plan.abortAfterStarts || resolved >= plan.abortAfterResolutions) {
      control.aborted = true;
      startedAtAbort = provider.calls.length;
    }
  };
  maybeAbort();
  const box: { value: T | undefined; finished: boolean } = { value: undefined, finished: false };
  const running = begin().then((value) => {
    box.value = value;
    box.finished = true;
  });
  for (let guard = 0; guard < 500 && !box.finished; guard += 1) {
    await flush();
    if (box.finished) break;
    maybeAbort();
    const outcome = plan.outcomes[resolved % Math.max(plan.outcomes.length, 1)] ?? 'good';
    const pick = plan.picks[resolved % Math.max(plan.picks.length, 1)] ?? 0;
    if (provider.settle(pick, outcome)) {
      resolved += 1;
      // Abort in the gap right after a resolution, before the pipeline's continuation runs.
      maybeAbort();
    }
  }
  if (!box.finished) throw new Error('pipeline did not finish');
  await running;
  return { result: box.value as T, resolved, startedAtAbort };
}

/** One full scenario: the human-heart notes, a deferred provider, the mock ledger and a plan. */
export async function runScenario(plan: Plan, over: Partial<PipelineOptions> = {}) {
  const control = { aborted: false };
  const deferred = makeDeferredProvider(control);
  const counted = countingProvider(deferred);
  const ledger = makeLargeLedger();
  const driven = await drive(control, deferred, plan, () =>
    runRoomPipeline(HEART, makePipelineOptions(counted, ledger, { signal: control, ...over })),
  );
  return { ...driven, deferred, counted, ledger };
}
