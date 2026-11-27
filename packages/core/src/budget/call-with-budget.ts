import type {
  Provider,
  ProviderFailure,
  ProviderRequest,
  ProviderSuccess,
  ProviderUsage,
} from '../provider/types';
import type { BudgetErrorKind, BudgetLedger } from './types';

export type CallWithBudgetResult =
  | { readonly ok: true; readonly response: ProviderSuccess; readonly actualUsd: number }
  | { readonly ok: false; readonly error: { readonly kind: 'budget'; readonly budget: BudgetErrorKind } }
  | { readonly ok: false; readonly error: { readonly kind: 'provider'; readonly failure: ProviderFailure } };

const THROWN_FAILURE: ProviderFailure = {
  ok: false,
  error: { kind: 'provider-error', retryable: false },
};

/**
 * The only way a stage may call a Provider. Reserves `worstCaseUsd` first; a refusal (budget
 * exhausted or ledger unavailable) returns a typed error and the Provider is never called. On
 * success the reservation is reconciled with `costOf(usage)`; on failure it is released.
 *
 * One call to this function is one reservation and at most one `provider.complete`. Provider
 * implementations retry internally under `request.retryLimit`; those retries sit inside the one
 * call and are covered by its worst-case reservation. A stage that retries on its own (for
 * example after malformed JSON) must call this function again, so each attempt gets its own
 * reservation. Never throws.
 */
export async function callWithBudget(
  ledger: BudgetLedger,
  provider: Provider,
  request: ProviderRequest,
  worstCaseUsd: number,
  costOf: (usage: ProviderUsage) => number,
): Promise<CallWithBudgetResult> {
  const reserved = await ledger.reserve(worstCaseUsd);
  if (!reserved.ok) {
    return { ok: false, error: { kind: 'budget', budget: reserved.error.kind } };
  }
  const { reservationId } = reserved.value;

  let result;
  try {
    result = await provider.complete(request);
  } catch {
    result = THROWN_FAILURE;
  }

  if (!result.ok) {
    await ledger.release(reservationId);
    return { ok: false, error: { kind: 'provider', failure: result } };
  }

  const actualUsd = costOf(result.usage);
  await ledger.reconcile(reservationId, actualUsd);
  return { ok: true, response: result, actualUsd };
}
