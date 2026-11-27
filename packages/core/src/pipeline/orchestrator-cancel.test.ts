import { describe, expect, it } from 'vitest';
import { makeMockLedger } from '../budget/mock-ledger';
import { HEART } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { makePipelineOptions, makeScriptedProvider } from './orchestrator-fixtures';
import { NEVER_ABORT, respond, runScenario, type Plan } from './orchestrator-cancel-fixtures';

const plan = (over: Partial<Plan>): Plan => ({ ...NEVER_ABORT, ...over });

/** The human-heart run makes 1 extraction, 4 generation and 4 review calls. */
const TOTAL_CALLS = 9;

function cancelledMetadata(result: Awaited<ReturnType<typeof runScenario>>['result']) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a cancelled failure');
  expect(result.error.error).toEqual({ kind: 'cancelled' });
  return result.error.metadata;
}

describe('runRoomPipeline cancellation', () => {
  it('abort before the run: no calls, no reservations, cancelled', async () => {
    const run = await runScenario(plan({ abortAfterStarts: 0 }));
    cancelledMetadata(run.result);
    expect(run.counted.calls).toBe(0);
    expect(run.ledger.reservations).toBe(0);
  });

  it('abort during extraction: the in-flight call reconciles and no generation call starts', async () => {
    const run = await runScenario(plan({ abortAfterStarts: 1 }));
    const metadata = cancelledMetadata(run.result);
    expect(run.deferred.calls.map((c) => c.stage)).toEqual(['concept-extraction']);
    expect(run.ledger.reservations).toBe(1);
    expect(run.ledger.reconciles).toBe(1);
    expect(run.ledger.outstandingMicroUsd).toBe(0);
    expect(metadata.promptDigests).toHaveLength(1);
  });

  it('abort in a generation retry gap: no retry call starts', async () => {
    // Call 1 (extraction) is good; call 2 (first generation) returns unusable JSON, which would
    // trigger one retry. The abort lands right after that resolution.
    const run = await runScenario(plan({ abortAfterResolutions: 2, outcomes: ['good', 'bad-json'] }), {
      concurrency: 1,
    });
    const metadata = cancelledMetadata(run.result);
    expect(run.deferred.calls.map((c) => c.stage)).toEqual(['concept-extraction', 'generation']);
    expect(run.ledger.reservations).toBe(2);
    expect(run.ledger.reconciles + run.ledger.releases).toBe(2);
    expect(run.ledger.outstandingMicroUsd).toBe(0);
    expect(metadata.promptDigests).toHaveLength(2);
  });

  it('abort during generation: no new calls, in-flight calls are counted and settled', async () => {
    const run = await runScenario(plan({ abortAfterStarts: 3 }));
    const metadata = cancelledMetadata(run.result);
    expect(run.startedAtAbort).toBe(run.deferred.calls.length);
    expect(run.deferred.calls.every((c) => !c.abortedAtStart)).toBe(true);
    expect(run.deferred.calls.some((c) => c.stage === 'review')).toBe(false);
    expect(run.ledger.reservations).toBe(run.ledger.reconciles + run.ledger.releases);
    expect(metadata.promptDigests).toHaveLength(run.counted.calls);
  });

  it('abort after every call completes but before assembly: cancelled, not published', async () => {
    const run = await runScenario(plan({ abortAfterResolutions: TOTAL_CALLS }));
    const metadata = cancelledMetadata(run.result);
    expect(run.counted.calls).toBe(TOTAL_CALLS);
    expect(metadata.promptDigests).toHaveLength(TOTAL_CALLS);
    expect(run.ledger.reconciles).toBe(TOTAL_CALLS);
    expect(run.ledger.outstandingMicroUsd).toBe(0);
  });

  it('a signal that never aborts leaves the result unchanged', async () => {
    const run = await runScenario(NEVER_ABORT);
    expect(run.startedAtAbort).toBeNull();
    expect(run.result.ok).toBe(true);
    expect(run.counted.calls).toBe(TOTAL_CALLS);
  });

  it('no signal at all: the end-to-end run still publishes', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const provider = makeScriptedProvider({
      'concept-extraction': (r) => respond(r, 'good'),
      generation: (r) => respond(r, 'good'),
      review: (r) => respond(r, 'good'),
    });
    const result = await runRoomPipeline(HEART, makePipelineOptions(provider, ledger));
    expect(result.ok).toBe(true);
    expect(provider.requests).toHaveLength(TOTAL_CALLS);
    expect(ledger.outstandingMicroUsd).toBe(0);
  });

  it('abort plus budget-exhausted: cancelled wins', async () => {
    // The ledger refuses the second reservation (first generation). The signal flips to aborted
    // at that moment, so the run has both a budget stop and an abort.
    const ledger = makeMockLedger({ dailyCapUsd: 1_000_000, refuseAfter: 1 });
    const signal = {
      get aborted(): boolean {
        return ledger.refusals >= 1;
      },
    };
    const provider = makeScriptedProvider({
      'concept-extraction': (r) => respond(r, 'good'),
      generation: (r) => respond(r, 'good'),
      review: (r) => respond(r, 'good'),
    });
    const result = await runRoomPipeline(HEART, makePipelineOptions(provider, ledger, { signal }));
    expect(ledger.refusals).toBeGreaterThanOrEqual(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toEqual({ kind: 'cancelled' });
    expect(ledger.outstandingMicroUsd).toBe(0);
  });
});
