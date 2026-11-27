import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import type { BudgetLedger, BudgetResult } from './types';

/**
 * Test-support only. Amounts cross the interface as USD numbers (per the design), but this ledger
 * stores them as integer micro-dollars (1 USD = 1_000_000) so repeated adds and subtracts never
 * drift. Each amount is rounded up (reserve) or to nearest (reconcile) once, on the way in.
 */
const MICRO = 1_000_000;

export interface MockLedgerOptions {
  readonly dailyCapUsd: number;
  /** After this many granted reservations, every further reserve is refused as `budget-exhausted`. */
  readonly refuseAfter?: number;
  /** When true, every call returns `ledger-unavailable` (simulated outage). */
  readonly unavailable?: boolean;
}

export interface MockLedger extends BudgetLedger {
  /** Granted reservations. */
  readonly reservations: number;
  /** Reserve calls refused for budget or outage reasons. */
  readonly refusals: number;
  readonly reconciles: number;
  readonly releases: number;
  /** Reserved-but-unsettled amount, in micro-dollars. */
  readonly outstandingMicroUsd: number;
  /** Reconciled spend, in micro-dollars. */
  readonly spentMicroUsd: number;
}

function ok<T>(value: T): BudgetResult<T> {
  return { ok: true, value };
}

function fail<T>(kind: 'budget-exhausted' | 'ledger-unavailable'): BudgetResult<T> {
  return { ok: false, error: { kind } };
}

function validAmount(usd: number): boolean {
  return Number.isFinite(usd) && usd >= 0;
}

export function makeMockLedger(options: MockLedgerOptions): MockLedger {
  const capMicro = validAmount(options.dailyCapUsd) ? Math.floor(options.dailyCapUsd * MICRO) : 0;
  const open = new Map<string, number>();
  let nextId = 1;
  let reservations = 0;
  let refusals = 0;
  let reconciles = 0;
  let releases = 0;
  let outstanding = 0;
  let spent = 0;

  return {
    get reservations() {
      return reservations;
    },
    get refusals() {
      return refusals;
    },
    get reconciles() {
      return reconciles;
    },
    get releases() {
      return releases;
    },
    get outstandingMicroUsd() {
      return outstanding;
    },
    get spentMicroUsd() {
      return spent;
    },
    async reserve(worstCaseUsd) {
      if (options.unavailable === true) {
        refusals += 1;
        return fail('ledger-unavailable');
      }
      if (!validAmount(worstCaseUsd)) {
        refusals += 1;
        return fail('budget-exhausted');
      }
      const micro = Math.ceil(worstCaseUsd * MICRO);
      const refused =
        (options.refuseAfter !== undefined && reservations >= options.refuseAfter) ||
        spent + outstanding + micro > capMicro;
      if (refused) {
        refusals += 1;
        return fail('budget-exhausted');
      }
      const reservationId = `mock-res-${nextId}`;
      nextId += 1;
      open.set(reservationId, micro);
      outstanding += micro;
      reservations += 1;
      return ok({ reservationId, reservedUsd: micro / MICRO });
    },
    async reconcile(reservationId, actualUsd) {
      if (options.unavailable === true) return fail('ledger-unavailable');
      const reserved = open.get(reservationId);
      if (reserved === undefined || !validAmount(actualUsd)) return fail('ledger-unavailable');
      open.delete(reservationId);
      outstanding -= reserved;
      spent += Math.round(actualUsd * MICRO);
      reconciles += 1;
      return ok(undefined);
    },
    async release(reservationId) {
      if (options.unavailable === true) return fail('ledger-unavailable');
      const reserved = open.get(reservationId);
      if (reserved === undefined) return fail('ledger-unavailable');
      open.delete(reservationId);
      outstanding -= reserved;
      releases += 1;
      return ok(undefined);
    },
  };
}

export interface CountingProvider extends Provider {
  /** Number of `complete` calls attempted, counted before the inner call runs. */
  readonly calls: number;
}

/** Wraps a Provider and counts attempted calls. A throwing inner provider becomes a `provider-error` failure. */
export function countingProvider(inner: Provider): CountingProvider {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async complete(request: ProviderRequest): Promise<ProviderResult> {
      calls += 1;
      try {
        return await inner.complete(request);
      } catch {
        return { ok: false, error: { kind: 'provider-error', retryable: false } };
      }
    },
  };
}
