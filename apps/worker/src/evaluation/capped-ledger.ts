import { z, type BudgetLedger, type BudgetResult } from '@escape-the-crypt/core';

/**
 * Evaluation_Skill budget ledger: one spending cap shared by every evaluation run of a task, kept
 * in a small JSON file so the cap holds across separate invocations. Amounts are integer
 * micro-dollars, like the Interim_Ledger. Spend is saved after every reconcile, so a crash loses
 * no record of money spent. Reservations are not persisted: a process that dies mid-call has not
 * been billed for an unfinished reply it never received the usage of, and the provider's own
 * project limit is the backstop.
 */
const MICRO = 1_000_000;

export const LedgerStateSchema = z.strictObject({
  capMicroUsd: z.number().int().positive(),
  spentMicroUsd: z.number().int().nonnegative(),
  runs: z.array(z.strictObject({ runId: z.string().min(1), spentMicroUsd: z.number().int().nonnegative() })),
});
export type LedgerState = z.infer<typeof LedgerStateSchema>;

export interface LedgerStore {
  /** Null when no ledger exists yet. */
  load(): unknown;
  save(state: LedgerState): void;
}

export type CappedLedgerError =
  | { readonly kind: 'ledger-file-invalid' }
  | { readonly kind: 'cap-mismatch'; readonly fileCapUsd: number };

export interface CappedLedger {
  readonly ledger: BudgetLedger;
  readonly capUsd: number;
  /** Spent before this run started. */
  readonly spentBeforeUsd: number;
  spentThisRunUsd(): number;
  remainingUsd(): number;
  /** True once any reservation was refused. */
  refused(): boolean;
}

const toMicro = (usd: number): number => Math.ceil(usd * MICRO);
const fromMicro = (micro: number): number => micro / MICRO;

export function openCappedLedger(
  store: LedgerStore,
  capUsd: number,
  runId: string,
): { ok: true; value: CappedLedger } | { ok: false; error: CappedLedgerError } {
  const capMicroUsd = toMicro(capUsd);
  const raw = store.load();
  let state: LedgerState;
  if (raw === null) {
    state = { capMicroUsd, spentMicroUsd: 0, runs: [] };
  } else {
    const parsed = LedgerStateSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: { kind: 'ledger-file-invalid' } };
    state = parsed.data;
    // Raising or lowering a task's cap is a decision for the user, never a side effect of a flag.
    if (state.capMicroUsd !== capMicroUsd) {
      return { ok: false, error: { kind: 'cap-mismatch', fileCapUsd: fromMicro(state.capMicroUsd) } };
    }
  }
  const spentBefore = state.spentMicroUsd;
  let spentRun = 0;
  let open = 0;
  let refusedAny = false;
  let next = 0;
  const reservations = new Map<string, number>();
  const persist = (): void => {
    const runs = state.runs.filter((r) => r.runId !== runId);
    state = { ...state, spentMicroUsd: spentBefore + spentRun, runs: [...runs, { runId, spentMicroUsd: spentRun }] };
    store.save(state);
  };

  const ledger: BudgetLedger = {
    reserve(worstCaseUsd: number): Promise<BudgetResult<{ reservationId: string; reservedUsd: number }>> {
      const amount = Number.isFinite(worstCaseUsd) && worstCaseUsd >= 0 ? toMicro(worstCaseUsd) : Number.POSITIVE_INFINITY;
      if (spentBefore + spentRun + open + amount > capMicroUsd) {
        refusedAny = true;
        return Promise.resolve({ ok: false, error: { kind: 'budget-exhausted' } });
      }
      const reservationId = `r${next++}`;
      reservations.set(reservationId, amount);
      open += amount;
      return Promise.resolve({ ok: true, value: { reservationId, reservedUsd: fromMicro(amount) } });
    },
    reconcile(reservationId: string, actualUsd: number): Promise<BudgetResult<void>> {
      const amount = reservations.get(reservationId);
      if (amount === undefined || !Number.isFinite(actualUsd) || actualUsd < 0) {
        return Promise.resolve({ ok: false, error: { kind: 'ledger-unavailable' } });
      }
      reservations.delete(reservationId);
      open -= amount;
      spentRun += toMicro(actualUsd);
      persist();
      return Promise.resolve({ ok: true, value: undefined });
    },
    release(reservationId: string): Promise<BudgetResult<void>> {
      const amount = reservations.get(reservationId);
      if (amount === undefined) return Promise.resolve({ ok: false, error: { kind: 'ledger-unavailable' } });
      reservations.delete(reservationId);
      open -= amount;
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
  persist();
  return {
    ok: true,
    value: {
      ledger,
      capUsd: fromMicro(capMicroUsd),
      spentBeforeUsd: fromMicro(spentBefore),
      spentThisRunUsd: () => fromMicro(spentRun),
      remainingUsd: () => fromMicro(capMicroUsd - spentBefore - spentRun),
      refused: () => refusedAny,
    },
  };
}
