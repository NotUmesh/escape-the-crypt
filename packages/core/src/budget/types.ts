export interface BudgetReservation {
  readonly reservationId: string;
  readonly reservedUsd: number;
}

export type BudgetErrorKind = 'budget-exhausted' | 'ledger-unavailable';

export type BudgetResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly kind: BudgetErrorKind } };

/**
 * Reserve a worst-case amount before every model call, reconcile the actual cost afterwards, and
 * release the reservation if the call fails. Async so the worker's interim ledger and a Postgres
 * ledger can implement it. Implementations never throw; every failure is a `BudgetResult` error.
 * The pipeline treats `ledger-unavailable` exactly like `budget-exhausted`: no call is made.
 */
export interface BudgetLedger {
  reserve(worstCaseUsd: number): Promise<BudgetResult<BudgetReservation>>;
  reconcile(reservationId: string, actualUsd: number): Promise<BudgetResult<void>>;
  release(reservationId: string): Promise<BudgetResult<void>>;
}
