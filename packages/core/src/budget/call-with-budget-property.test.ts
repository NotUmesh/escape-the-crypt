import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import type { Provider, ProviderErrorKind, ProviderRequest, ProviderResult } from '../provider/types';
import { callWithBudget } from './call-with-budget';
import { countingProvider, makeMockLedger } from './mock-ledger';

const request: ProviderRequest = {
  stage: 'generation',
  promptVersion: 'test-1',
  modelId: 'test-model',
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0,
  maxOutputTokens: 100,
  jsonSchema: { type: 'object' },
  timeoutMs: 1000,
  retryLimit: 2,
};

type Behaviour = 'success' | ProviderErrorKind | 'throws';

const behaviourArb: fc.Arbitrary<Behaviour> = fc.constantFrom<Behaviour>(
  'success',
  'timeout',
  'rate-limited',
  'provider-error',
  'invalid-response-shape',
  'throws',
);

/** Simple fault-injecting fake: behaviour for call N is taken from the script (cycling). */
function faultProvider(script: readonly Behaviour[]): Provider {
  let n = 0;
  return {
    async complete(): Promise<ProviderResult> {
      const b = script[n % script.length] ?? 'success';
      n += 1;
      if (b === 'throws') throw new Error('injected');
      if (b === 'success') return { ok: true, json: {}, usage: { inputTokens: 10, outputTokens: 5 } };
      return { ok: false, error: { kind: b, retryable: b !== 'invalid-response-shape' } };
    },
  };
}

const costOf = (u: { inputTokens: number; outputTokens: number }): number =>
  (u.inputTokens + u.outputTokens) / 1_000_000;

describe('callWithBudget', () => {
  // Feature: generation-and-evaluation, Property 17: Provider calls never exceed budget reservations
  // **Validates: Requirements 12.6, 12.7, 12.8**
  it('Property 17: provider calls never exceed reservations; nothing stays outstanding', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          dailyCapUsd: fc.double({ min: 0, max: 1, noNaN: true }),
          refuseAfter: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
          unavailable: fc.boolean(),
        }),
        fc.array(behaviourArb, { minLength: 1, maxLength: 8 }),
        fc.array(fc.double({ min: 0, max: 0.2, noNaN: true }), { minLength: 0, maxLength: 15 }),
        async (ledgerOpts, script, worstCases) => {
          const ledger = makeMockLedger(ledgerOpts);
          const provider = countingProvider(faultProvider(script));
          let anyThrow = false;

          for (const worst of worstCases) {
            const callsBefore = provider.calls;
            const refusalsBefore = ledger.refusals;
            try {
              const r = await callWithBudget(ledger, provider, request, worst, costOf);
              if (!r.ok && r.error.kind === 'budget') {
                expect(provider.calls).toBe(callsBefore);
                expect(ledger.refusals).toBe(refusalsBefore + 1);
              }
            } catch {
              anyThrow = true;
            }
            expect(provider.calls).toBeLessThanOrEqual(ledger.reservations);
          }

          expect(anyThrow).toBe(false);
          if (ledgerOpts.unavailable) {
            expect(provider.calls).toBe(0);
            expect(ledger.reservations).toBe(0);
          }
          if (ledgerOpts.refuseAfter !== undefined) {
            expect(ledger.reservations).toBeLessThanOrEqual(ledgerOpts.refuseAfter);
          }
          expect(ledger.reconciles + ledger.releases).toBe(ledger.reservations);
          expect(ledger.outstandingMicroUsd).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('makes no call when the ledger refuses every reservation', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 10, refuseAfter: 0 });
    const provider = countingProvider(faultProvider(['success']));
    const r = await callWithBudget(ledger, provider, request, 0.01, costOf);
    expect(r).toEqual({ ok: false, error: { kind: 'budget', budget: 'budget-exhausted' } });
    expect(provider.calls).toBe(0);
  });
});
