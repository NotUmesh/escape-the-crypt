import { describe, it, expect } from 'vitest';
import { makeInterimLedger } from './interim-ledger';

const PRICES = { inputUsdPerMTok: 2, outputUsdPerMTok: 10 };
const MICRO_USD = 0.000001;
const LAST_MS_OF_DAY = Date.UTC(2025, 0, 1, 23, 59, 59, 999);
const MIDNIGHT = Date.UTC(2025, 0, 2, 0, 0, 0, 0);

function clock(start: number) {
  const state = { t: start };
  return { now: () => state.t, set: (t: number) => void (state.t = t) };
}

function ledgerWith(cap: number | undefined, c = clock(LAST_MS_OF_DAY - 5000)) {
  return { c, ledger: makeInterimLedger({ dailyBudgetUsd: cap, prices: PRICES, now: c.now }) };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}`);
  return r.value;
}

describe('Interim_Ledger cap enforcement (Req 28.3, 28.4)', () => {
  it('allows a reservation exactly at the cap', async () => {
    const { ledger } = ledgerWith(1);
    const r = await ledger.reserve(1);
    expect(r.ok).toBe(true);
  });

  it('refuses a reservation 1 micro-USD over the cap', async () => {
    const { ledger } = ledgerWith(1);
    const r = await ledger.reserve(1 + MICRO_USD);
    expect(r).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
  });

  it('counts outstanding reservations against the cap', async () => {
    const { ledger } = ledgerWith(1);
    must(await ledger.reserve(0.6));
    expect((await ledger.reserve(0.4)).ok).toBe(true);
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
  });

  it('counts spent against the cap', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.6));
    must(await ledger.reconcile(a.reservationId, 0.6));
    expect((await ledger.reserve(0.4 + MICRO_USD)).ok).toBe(false);
    expect((await ledger.reserve(0.4)).ok).toBe(true);
  });

  it('rounds reservations up to the next micro-USD', async () => {
    const { ledger } = ledgerWith(0.000002);
    const a = must(await ledger.reserve(0.0000011));
    expect(a.reservedUsd).toBeCloseTo(0.000002, 12);
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
  });

  it('rejects invalid amounts', async () => {
    const { ledger } = ledgerWith(1);
    for (const bad of [Infinity, NaN, -0.1]) {
      expect((await ledger.reserve(bad)).ok).toBe(false);
    }
  });

  it('grants exactly one of two concurrent reserves that together exceed the cap', async () => {
    const { ledger } = ledgerWith(1);
    const results = await Promise.all([ledger.reserve(0.6), ledger.reserve(0.6)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
  });

  it('issues distinct reservation ids', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.1));
    const b = must(await ledger.reserve(0.1));
    expect(a.reservationId).not.toBe(b.reservationId);
  });
});

describe('Interim_Ledger reconcile (Req 28.5)', () => {
  it('replaces the reserved amount with a lower actual cost and frees the difference', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.8));
    must(await ledger.reconcile(a.reservationId, 0.3));
    expect((await ledger.reserve(0.7)).ok).toBe(true);
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
  });

  it('counts an actual cost above the reservation as spent', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.5));
    must(await ledger.reconcile(a.reservationId, 0.9));
    expect((await ledger.reserve(0.1 + MICRO_USD)).ok).toBe(false);
    expect((await ledger.reserve(0.1)).ok).toBe(true);
  });

  it('rounds the actual cost to the nearest micro-USD', async () => {
    const { ledger } = ledgerWith(0.000010);
    const a = must(await ledger.reserve(0.000010));
    must(await ledger.reconcile(a.reservationId, 0.0000044)); // rounds to 4
    // 6 micro-USD remain
    expect((await ledger.reserve(0.000006)).ok).toBe(true);
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);

    const { ledger: l2 } = ledgerWith(0.000010);
    const b = must(await l2.reserve(0.000010));
    must(await l2.reconcile(b.reservationId, 0.0000046)); // rounds to 5
    expect((await l2.reserve(0.000005)).ok).toBe(true);
    expect((await l2.reserve(MICRO_USD)).ok).toBe(false);
  });

  it('returns ledger-unavailable for an unknown id', async () => {
    const { ledger } = ledgerWith(1);
    expect(await ledger.reconcile('nope', 0.1)).toEqual({
      ok: false,
      error: { kind: 'ledger-unavailable' },
    });
  });

  it('returns ledger-unavailable for an invalid actual and keeps the reservation open', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(1));
    for (const bad of [Infinity, NaN, -1]) {
      expect(await ledger.reconcile(a.reservationId, bad)).toEqual({
        ok: false,
        error: { kind: 'ledger-unavailable' },
      });
    }
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
    expect((await ledger.reconcile(a.reservationId, 0.5)).ok).toBe(true);
  });

  it('returns ledger-unavailable on a double reconcile and does not double count', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.5));
    must(await ledger.reconcile(a.reservationId, 0.5));
    expect(await ledger.reconcile(a.reservationId, 0.5)).toEqual({
      ok: false,
      error: { kind: 'ledger-unavailable' },
    });
    expect((await ledger.reserve(0.5)).ok).toBe(true);
  });
});

describe('Interim_Ledger release (Req 28.6)', () => {
  it('returns the full reservation to the remaining budget', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(1));
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
    must(await ledger.release(a.reservationId));
    expect((await ledger.reserve(1)).ok).toBe(true);
  });

  it('returns ledger-unavailable on a double release', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.5));
    must(await ledger.release(a.reservationId));
    expect(await ledger.release(a.reservationId)).toEqual({
      ok: false,
      error: { kind: 'ledger-unavailable' },
    });
    // A double release must not free more than was reserved.
    expect((await ledger.reserve(1)).ok).toBe(true);
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
  });

  it('returns ledger-unavailable for release after reconcile and reconcile after release', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.2));
    must(await ledger.reconcile(a.reservationId, 0.1));
    expect((await ledger.release(a.reservationId)).ok).toBe(false);
    const b = must(await ledger.reserve(0.2));
    must(await ledger.release(b.reservationId));
    expect((await ledger.reconcile(b.reservationId, 0.1)).ok).toBe(false);
  });

  it('returns ledger-unavailable for an unknown id', async () => {
    const { ledger } = ledgerWith(1);
    expect((await ledger.release('missing')).ok).toBe(false);
  });
});

describe('Interim_Ledger UTC day rollover (Req 28.7)', () => {
  it('keeps spent at 23:59:59.999Z and resets it at 00:00:00.000Z', async () => {
    const { ledger, c } = ledgerWith(1, clock(LAST_MS_OF_DAY));
    const a = must(await ledger.reserve(1));
    must(await ledger.reconcile(a.reservationId, 1));
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);

    c.set(MIDNIGHT);
    expect((await ledger.reserve(1)).ok).toBe(true);
  });

  it('does not reset within the same UTC day regardless of local time zone', async () => {
    // 00:00:00 UTC+14 and 23:59 UTC-12 on the same UTC day must not trigger a rollover.
    const start = Date.UTC(2025, 0, 1, 10, 0, 0, 0);
    const { ledger, c } = ledgerWith(1, clock(start));
    const a = must(await ledger.reserve(1));
    must(await ledger.reconcile(a.reservationId, 1));
    for (const t of [Date.UTC(2025, 0, 1, 0, 0, 0, 0), Date.UTC(2025, 0, 1, 12, 0, 0, 0), LAST_MS_OF_DAY]) {
      c.set(t);
      expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
    }
  });

  it('resets again on each later UTC day', async () => {
    const { ledger, c } = ledgerWith(1, clock(LAST_MS_OF_DAY));
    for (let day = 0; day < 3; day += 1) {
      c.set(MIDNIGHT + day * 86_400_000);
      const a = must(await ledger.reserve(1));
      must(await ledger.reconcile(a.reservationId, 1));
      expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
    }
  });

  it('carries an outstanding reservation across midnight and counts its reconcile against the new day', async () => {
    const { ledger, c } = ledgerWith(1, clock(LAST_MS_OF_DAY));
    const a = must(await ledger.reserve(0.6));
    c.set(MIDNIGHT);
    // The outstanding 0.6 still counts in the new day.
    expect((await ledger.reserve(0.5)).ok).toBe(false);
    must(await ledger.reconcile(a.reservationId, 0.4));
    // New day: spent = 0.4, nothing outstanding.
    expect((await ledger.reserve(0.6 + MICRO_USD)).ok).toBe(false);
    expect((await ledger.reserve(0.6)).ok).toBe(true);
  });

  it('carries an outstanding reservation across midnight and releases it', async () => {
    const { ledger, c } = ledgerWith(1, clock(LAST_MS_OF_DAY));
    const a = must(await ledger.reserve(1));
    c.set(MIDNIGHT);
    expect((await ledger.reserve(MICRO_USD)).ok).toBe(false);
    must(await ledger.release(a.reservationId));
    expect((await ledger.reserve(1)).ok).toBe(true);
  });
});

