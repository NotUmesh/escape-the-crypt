import { describe, expect, it } from 'vitest';
import { openCappedLedger, type LedgerState, type LedgerStore } from './capped-ledger';

function memoryStore(initial: unknown = null): LedgerStore & { state: () => unknown } {
  let saved: unknown = initial;
  return { load: () => saved, save: (s: LedgerState) => void (saved = JSON.parse(JSON.stringify(s))), state: () => saved };
}

function open(store: LedgerStore, cap = 1.2, runId = 'run-1') {
  const opened = openCappedLedger(store, cap, runId);
  if (!opened.ok) throw new Error(opened.error.kind);
  return opened.value;
}

describe('openCappedLedger', () => {
  it('refuses a reservation that would pass the cap and never calls past it', async () => {
    const budget = open(memoryStore(), 0.1);
    const first = await budget.ledger.reserve(0.06);
    expect(first.ok).toBe(true);
    expect((await budget.ledger.reserve(0.05)).ok).toBe(false);
    expect(budget.refused()).toBe(true);
  });

  it('counts only reconciled spend and frees released reservations', async () => {
    const budget = open(memoryStore(), 0.1);
    const a = await budget.ledger.reserve(0.08);
    if (!a.ok) throw new Error('reserve failed');
    await budget.ledger.reconcile(a.value.reservationId, 0.01);
    const b = await budget.ledger.reserve(0.08);
    if (!b.ok) throw new Error('reserve failed');
    await budget.ledger.release(b.value.reservationId);
    expect(budget.spentThisRunUsd()).toBeCloseTo(0.01, 6);
    expect(budget.remainingUsd()).toBeCloseTo(0.09, 6);
    expect(budget.refused()).toBe(false);
  });

  it('holds one cap across separate runs: spend is saved after every reconcile', async () => {
    const store = memoryStore();
    const run1 = open(store, 0.1, 'run-1');
    const r = await run1.ledger.reserve(0.05);
    if (!r.ok) throw new Error('reserve failed');
    await run1.ledger.reconcile(r.value.reservationId, 0.07);

    const run2 = open(store, 0.1, 'run-2');
    expect(run2.spentBeforeUsd).toBeCloseTo(0.07, 6);
    expect((await run2.ledger.reserve(0.04)).ok).toBe(false);
    expect((await run2.ledger.reserve(0.03)).ok).toBe(true);
    expect(store.state()).toEqual({
      capMicroUsd: 100_000,
      spentMicroUsd: 70_000,
      runs: [
        { runId: 'run-1', spentMicroUsd: 70_000 },
        { runId: 'run-2', spentMicroUsd: 0 },
      ],
    });
  });

  it('refuses to open with a cap different from the file, or a file that does not parse', () => {
    const store = memoryStore({ capMicroUsd: 600_000, spentMicroUsd: 1, runs: [] });
    expect(openCappedLedger(store, 1.2, 'r')).toEqual({ ok: false, error: { kind: 'cap-mismatch', fileCapUsd: 0.6 } });
    expect(openCappedLedger(memoryStore({ cap: 'lots' }), 1.2, 'r')).toEqual({
      ok: false,
      error: { kind: 'ledger-file-invalid' },
    });
  });

  it('refuses an invalid amount and rejects unknown reservation ids', async () => {
    const budget = open(memoryStore());
    expect((await budget.ledger.reserve(Number.NaN)).ok).toBe(false);
    expect((await budget.ledger.reconcile('nope', 0)).ok).toBe(false);
    expect((await budget.ledger.release('nope')).ok).toBe(false);
  });
});
