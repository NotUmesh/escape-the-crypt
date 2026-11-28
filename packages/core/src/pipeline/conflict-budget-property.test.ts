import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BudgetLedger } from '../budget/types';
import { makeMockLedger, type MockLedger } from '../budget/mock-ledger';
import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import { RUN_LENGTHS, cryptTargetFor, type RunLength } from '../run-length';
import { DEFAULT_CONCURRENCY } from './concurrency';
import { HEART } from './generation-fixtures';
import { runRoomPipeline } from './orchestrator';
import {
  OUTCOMES,
  NEVER_ABORT,
  drive,
  respond,
  type DeferredProvider,
  type Outcome,
  type Plan,
  type StartedCall,
} from './orchestrator-cancel-fixtures';
import { makeLargeLedger, makePipelineOptions } from './orchestrator-fixtures';

// Feature: generation-and-evaluation, Property 34: Conflict calls respect the budget, concurrency and cancellation rules
// **Validates: Requirements 18.2, 12.6, 12.7, 12.8, 11.6, 16.7**

/** Compile-time check: adding or removing a BudgetLedger member breaks this literal. */
const LEDGER_KEYS_FROZEN: Record<keyof BudgetLedger, true> = { reserve: true, reconcile: true, release: true };

const WORST_CASE_USD = 0.001;
const USAGE = { inputTokens: 100, outputTokens: 50 };

/** A clean reply for every question id the conflict prompt shows. */
function cleanReply(request: ProviderRequest): ProviderResult {
  const text = request.messages[0]?.content ?? '';
  const sections = text.split(/(?=Question q\d+)/).slice(1);
  const results = sections.map((section) => ({
    questionId: /^Question (q\d+)/.exec(section)?.[1] ?? 'q0',
    conflict: false,
    paragraph: null,
    quote: null,
  }));
  return { ok: true, json: { results }, usage: USAGE };
}

type Gate = DeferredProvider;

/** Every stage but the conflict check answers at once; conflict calls stay in flight until settled. */
function makeConflictGate(control: { aborted: boolean }): Gate {
  const calls: StartedCall[] = [];
  const pending: { request: ProviderRequest; resolve: (r: ProviderResult) => void }[] = [];
  return {
    calls,
    get pendingCount() {
      return pending.length;
    },
    complete(request) {
      if (request.stage !== 'conflict-check') return Promise.resolve(respond(request, 'good'));
      calls.push({ index: calls.length, stage: request.stage, abortedAtStart: control.aborted });
      return new Promise<ProviderResult>((resolve) => pending.push({ request, resolve }));
    },
    settle(pick, outcome) {
      const [entry] = pending.splice(pick % Math.max(pending.length, 1), 1);
      if (entry === undefined) return false;
      entry.resolve(outcome === 'good' ? cleanReply(entry.request) : respond(entry.request, outcome));
      return true;
    },
  };
}

interface Trace {
  inFlight: number;
  peak: number;
  providerCalls: number;
  callsWithoutReservation: number;
  callsAfterAbort: number;
  reserveAmounts: number[];
}

function instrument(base: MockLedger, inner: Provider, control: { aborted: boolean }) {
  const trace: Trace = {
    inFlight: 0,
    peak: 0,
    providerCalls: 0,
    callsWithoutReservation: 0,
    callsAfterAbort: 0,
    reserveAmounts: [],
  };
  const provider: Provider = {
    async complete(request) {
      trace.providerCalls += 1;
      if (base.reservations < trace.providerCalls) trace.callsWithoutReservation += 1;
      if (control.aborted) trace.callsAfterAbort += 1;
      const conflict = request.stage === 'conflict-check';
      if (conflict) {
        trace.inFlight += 1;
        trace.peak = Math.max(trace.peak, trace.inFlight);
      }
      try {
        return await inner.complete(request);
      } finally {
        if (conflict) trace.inFlight -= 1;
      }
    },
  };
  const ledger: BudgetLedger = {
    reserve: (usd) => {
      trace.reserveAmounts.push(usd);
      return base.reserve(usd);
    },
    reconcile: (id, usd) => base.reconcile(id, usd),
    release: (id) => base.release(id),
  };
  return { trace, provider, ledger };
}

interface Scenario {
  readonly plan: Plan;
  readonly refuseAfter?: number;
  readonly concurrency?: number;
  readonly length: RunLength;
}

async function runScenario(s: Scenario) {
  const control = { aborted: false };
  const gate = makeConflictGate(control);
  const base = s.refuseAfter === undefined ? makeLargeLedger() : makeMockLedger({ dailyCapUsd: 1_000_000, refuseAfter: s.refuseAfter });
  const { trace, provider, ledger } = instrument(base, gate, control);
  const driven = await drive(control, gate, s.plan, () =>
    runRoomPipeline(
      HEART,
      makePipelineOptions(provider, base, {
        ledger,
        signal: control,
        conflictCheck: true,
        target: cryptTargetFor(s.length),
        worstCaseUsd: WORST_CASE_USD,
        ...(s.concurrency !== undefined && { concurrency: s.concurrency }),
      }),
    ),
  );
  return { ...driven, gate, base, trace };
}

const point = fc.oneof(fc.integer({ min: 0, max: 6 }), fc.constant(Number.POSITIVE_INFINITY));
const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  plan: fc.record({
    abortAfterStarts: point,
    abortAfterResolutions: point,
    outcomes: fc.array(fc.constantFrom<Outcome>(...OUTCOMES), { minLength: 1, maxLength: 8 }),
    picks: fc.array(fc.nat({ max: 20 }), { minLength: 1, maxLength: 8 }),
  }),
  refuseAfter: fc.option(fc.integer({ min: 0, max: 14 }), { nil: undefined }),
  concurrency: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
  length: fc.constantFrom(...RUN_LENGTHS),
});

describe('conflict calls: budget, concurrency and cancellation', () => {
  it('Property 34: first attempts equal the provisional rooms when every reply is clean', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...RUN_LENGTHS), fc.integer({ min: 1, max: 4 }), async (length, concurrency) => {
        const run = await runScenario({ plan: NEVER_ABORT, length, concurrency });
        if (!run.result.ok) throw new Error(run.result.error.error.kind);
        expect(run.gate.calls.length).toBe(run.result.value.manifest.rooms.length);
        expect(run.gate.calls.length).toBeGreaterThan(0);
        expect(run.trace.peak).toBeLessThanOrEqual(concurrency);
        expect(run.trace.inFlight).toBe(0);
      }),
      { numRuns: 12 },
    );
  });

  it('Property 34: reservations, refusals, concurrency and abort hold for any plan', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const run = await runScenario(s);
        const { base, trace, gate } = run;

        // In flight never exceeds 4, and ends at 0.
        expect(trace.peak).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
        expect(trace.inFlight).toBe(0);

        // Every call has its own prior granted reservation; refused reservations make no call.
        expect(trace.callsWithoutReservation).toBe(0);
        expect(trace.providerCalls).toBeLessThanOrEqual(base.reservations);
        if (s.refuseAfter !== undefined) expect(base.reservations).toBeLessThanOrEqual(s.refuseAfter);

        // Every reservation is reconciled or released, with the pinned worst-case amount.
        expect(base.reconciles + base.releases).toBe(base.reservations);
        expect(base.outstandingMicroUsd).toBe(0);
        expect(trace.reserveAmounts.every((a) => a === WORST_CASE_USD)).toBe(true);

        // No call starts after the abort.
        expect(trace.callsAfterAbort).toBe(0);
        expect(gate.calls.every((c) => !c.abortedAtStart)).toBe(true);
        if (run.startedAtAbort !== null) expect(gate.calls.length).toBe(run.startedAtAbort);
      }),
      { numRuns: 60 },
    );
  });

  it('Property 34: a refused reservation makes no conflict call', async () => {
    const all = await runScenario({ plan: NEVER_ABORT, length: 'short' });
    const before = all.trace.providerCalls - all.gate.calls.length;
    const run = await runScenario({ plan: NEVER_ABORT, length: 'short', refuseAfter: before });
    expect(run.base.refusals).toBeGreaterThan(0);
    expect(run.gate.calls.length).toBe(0);
    expect(run.trace.providerCalls).toBe(run.base.reservations);
    expect(run.result.ok).toBe(false);
  });

  it('keeps DEFAULT_CONCURRENCY at 4 and the BudgetLedger at reserve, reconcile and release', () => {
    expect(DEFAULT_CONCURRENCY).toBe(4);
    expect(Object.keys(LEDGER_KEYS_FROZEN).sort()).toEqual(['reconcile', 'release', 'reserve']);
    const methods = Object.entries(makeMockLedger({ dailyCapUsd: 1 }))
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort();
    expect(methods).toEqual(['reconcile', 'release', 'reserve']);
  });
});
