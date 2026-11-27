import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { OUTCOMES, runScenario, type Plan } from './orchestrator-cancel-fixtures';

// Feature: generation-and-evaluation, Property 21: Cancellation never starts a call after abort and leaves no reservation outstanding

/** The run makes at most 9 calls on a clean pass; 14 also reaches past the end (no abort fires). */
const point = fc.oneof(fc.integer({ min: 0, max: 14 }), fc.constant(Number.POSITIVE_INFINITY));

const planArb: fc.Arbitrary<Plan> = fc.record({
  abortAfterStarts: point,
  abortAfterResolutions: point,
  outcomes: fc.array(fc.constantFrom(...OUTCOMES), { minLength: 1, maxLength: 12 }),
  picks: fc.array(fc.nat({ max: 20 }), { minLength: 1, maxLength: 12 }),
});

describe('runRoomPipeline cancellation property', () => {
  it('Property 21: no call starts after an abort, nothing stays reserved, the result is cancelled', async () => {
    // **Validates: Requirements 16.7, 12.6, 12.7**
    await fc.assert(
      fc.asyncProperty(planArb, fc.integer({ min: 1, max: 4 }), async (plan, concurrency) => {
        const run = await runScenario(plan, { concurrency });

        // Every call that started saw an un-aborted signal, and none started after the abort.
        expect(run.deferred.calls.every((c) => !c.abortedAtStart)).toBe(true);
        if (run.startedAtAbort !== null) expect(run.deferred.calls.length).toBe(run.startedAtAbort);

        // Every granted reservation is settled.
        expect(run.ledger.reservations).toBe(run.ledger.reconciles + run.ledger.releases);
        expect(run.ledger.outstandingMicroUsd).toBe(0);

        // Metadata counts exactly the calls made.
        expect(run.counted.calls).toBe(run.deferred.calls.length);
        const metadata = run.result.ok ? run.result.value.metadata : run.result.error.metadata;
        expect(metadata.promptDigests).toHaveLength(run.deferred.calls.length);

        // After an abort the run is cancelled and never a manifest.
        if (run.startedAtAbort !== null) {
          expect(run.result.ok).toBe(false);
          if (!run.result.ok) expect(run.result.error.error).toEqual({ kind: 'cancelled' });
        }
      }),
      { numRuns: 150 },
    );
  });
});
