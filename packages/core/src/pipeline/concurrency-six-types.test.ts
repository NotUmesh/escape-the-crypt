import { describe, expect, it } from 'vitest';
import type { BudgetLedger } from '../budget/types';
import { countingProvider, makeMockLedger } from '../budget/mock-ledger';
import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import type { LockType } from '../types';
import { DEFAULT_CONCURRENCY } from './concurrency';
import { HEART } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import { drive, makeDeferredProvider, NEVER_ABORT } from './orchestrator-cancel-fixtures';
import { makeLargeLedger, makePipelineOptions } from './orchestrator-fixtures';

// Feature: generation-and-evaluation, Property 17 pattern, with all six lock types allowed.
// **Validates: Requirements 11.6, 12.6, 22.8**

const ALL_SIX: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];

/** Compile-time check: adding or removing a BudgetLedger member breaks this literal. */
const LEDGER_KEYS_FROZEN: Record<keyof BudgetLedger, true> = { reserve: true, reconcile: true, release: true };

interface Trace {
  inFlight: number;
  peak: number;
  providerCalls: number;
  /** Calls that started with fewer granted reservations than provider calls so far. */
  callsWithoutReservation: number;
}

/** Instruments a ledger and a provider; the ledger and provider underneath are unchanged. */
function instrument(base: ReturnType<typeof makeMockLedger>, inner: Provider) {
  const trace: Trace = { inFlight: 0, peak: 0, providerCalls: 0, callsWithoutReservation: 0 };
  const provider: Provider = {
    async complete(request: ProviderRequest): Promise<ProviderResult> {
      trace.providerCalls += 1;
      if (base.reservations < trace.providerCalls) trace.callsWithoutReservation += 1;
      trace.inFlight += 1;
      trace.peak = Math.max(trace.peak, trace.inFlight);
      try {
        return await inner.complete(request);
      } finally {
        trace.inFlight -= 1;
      }
    },
  };
  return { trace, provider };
}

async function runSixTypes(over: { concurrency?: number } = {}) {
  const control = { aborted: false };
  const deferred = makeDeferredProvider(control);
  const ledger = makeLargeLedger();
  const { trace, provider } = instrument(ledger, deferred);
  const counted = countingProvider(provider);
  const driven = await drive(control, deferred, NEVER_ABORT, () =>
    runRoomPipeline(
      HEART,
      makePipelineOptions(counted, ledger, { signal: control, allowedLockTypes: ALL_SIX, ...over }),
    ),
  );
  return { ...driven, trace, ledger, counted, deferred };
}

describe('runRoomPipeline concurrency and budget with all six lock types allowed', () => {
  it('keeps the default concurrency constant at 4', () => {
    expect(DEFAULT_CONCURRENCY).toBe(4);
  });

  it('never exceeds 4 provider calls in flight and reaches 4 when work allows', async () => {
    const run = await runSixTypes();
    expect(run.result.ok).toBe(true);
    expect(run.trace.peak).toBeLessThanOrEqual(4);
    expect(run.trace.peak).toBeGreaterThan(1);
    expect(run.trace.inFlight).toBe(0);
  });

  it('applies the default limit of 4 when no concurrency is passed', async () => {
    const run = await runSixTypes({ concurrency: undefined });
    expect(run.result.ok).toBe(true);
    expect(run.trace.peak).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
  });

  it('reserves before every provider call and reconciles or releases every reservation', async () => {
    const run = await runSixTypes();
    expect(run.trace.providerCalls).toBeGreaterThan(0);
    expect(run.trace.callsWithoutReservation).toBe(0);
    expect(run.counted.calls).toBe(run.trace.providerCalls);
    expect(run.ledger.reservations).toBeGreaterThanOrEqual(run.counted.calls);
    expect(run.ledger.reconciles + run.ledger.releases).toBe(run.ledger.reservations);
    expect(run.ledger.outstandingMicroUsd).toBe(0);
  });

  it('keeps the BudgetLedger interface at reserve, reconcile and release', () => {
    expect(Object.keys(LEDGER_KEYS_FROZEN).sort()).toEqual(['reconcile', 'release', 'reserve']);
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const methods = Object.keys(ledger)
      .filter((k) => typeof (ledger as unknown as Record<string, unknown>)[k] === 'function')
      .sort();
    expect(methods).toEqual(['reconcile', 'release', 'reserve']);
  });
});
