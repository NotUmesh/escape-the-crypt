import { describe, expect, it } from 'vitest';
import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import { countingProvider, makeMockLedger } from './mock-ledger';
import type { BudgetErrorKind, BudgetLedger } from './types';

const request: ProviderRequest = {
  stage: 'generation',
  promptVersion: 'test-1',
  modelId: 'test-model',
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0,
  maxOutputTokens: 100,
  jsonSchema: {},
  timeoutMs: 1000,
  retryLimit: 0,
};

const success: ProviderResult = { ok: true, json: {}, usage: { inputTokens: 1, outputTokens: 1 } };

const okProvider: Provider = { complete: async () => success };
const failingProvider: Provider = {
  complete: async () => ({ ok: false, error: { kind: 'timeout', retryable: true } }),
};

type StageOutcome =
  | { readonly ok: true; readonly result: ProviderResult }
  | { readonly ok: false; readonly reason: BudgetErrorKind | 'provider-failed' };

/** Local mirror of the design's order: reserve, call, reconcile on success, release on failure. */
async function callWithBudget(
  ledger: BudgetLedger,
  provider: Provider,
  req: ProviderRequest,
  worstCase: number,
): Promise<StageOutcome> {
  const reserved = await ledger.reserve(worstCase);
  if (!reserved.ok) return { ok: false, reason: reserved.error.kind };
  const result = await provider.complete(req);
  if (!result.ok) {
    await ledger.release(reserved.value.reservationId);
    return { ok: false, reason: 'provider-failed' };
  }
  await ledger.reconcile(reserved.value.reservationId, worstCase / 2);
  return { ok: true, result };
}

describe('mock ledger: reserve, reconcile, release', () => {
  it('reserve grants an id and counts outstanding micro-USD', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const r = await ledger.reserve(0.25);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reservedUsd).toBe(0.25);
    expect(ledger.reservations).toBe(1);
    expect(ledger.outstandingMicroUsd).toBe(250_000);
    expect(ledger.spentMicroUsd).toBe(0);
  });

  it('reserve rounds a sub-micro amount up', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const r = await ledger.reserve(0.0000001);
    expect(r.ok).toBe(true);
    expect(ledger.outstandingMicroUsd).toBe(1);
  });

  it('reconcile moves the reservation to spent at the actual amount', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const r = await ledger.reserve(0.5);
    if (!r.ok) throw new Error('expected grant');
    const done = await ledger.reconcile(r.value.reservationId, 0.2);
    expect(done.ok).toBe(true);
    expect(ledger.reconciles).toBe(1);
    expect(ledger.outstandingMicroUsd).toBe(0);
    expect(ledger.spentMicroUsd).toBe(200_000);
  });

  it('release frees the reservation without spending', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const r = await ledger.reserve(0.5);
    if (!r.ok) throw new Error('expected grant');
    const done = await ledger.release(r.value.reservationId);
    expect(done.ok).toBe(true);
    expect(ledger.releases).toBe(1);
    expect(ledger.outstandingMicroUsd).toBe(0);
    expect(ledger.spentMicroUsd).toBe(0);
  });

  it('released budget can be reserved again', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const a = await ledger.reserve(1);
    if (!a.ok) throw new Error('expected grant');
    expect((await ledger.reserve(0.1)).ok).toBe(false);
    await ledger.release(a.value.reservationId);
    expect((await ledger.reserve(0.1)).ok).toBe(true);
  });

  it('reservation ids are unique', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const a = await ledger.reserve(0.1);
    const b = await ledger.reserve(0.1);
    if (!a.ok || !b.ok) throw new Error('expected grants');
    expect(a.value.reservationId).not.toBe(b.value.reservationId);
  });

  it('a second reconcile or release of the same id is a typed error', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const r = await ledger.reserve(0.5);
    if (!r.ok) throw new Error('expected grant');
    await ledger.reconcile(r.value.reservationId, 0.1);
    const again = await ledger.reconcile(r.value.reservationId, 0.1);
    const rel = await ledger.release(r.value.reservationId);
    expect(again.ok).toBe(false);
    expect(rel.ok).toBe(false);
    expect(ledger.spentMicroUsd).toBe(100_000);
    expect(ledger.reconciles).toBe(1);
    expect(ledger.releases).toBe(0);
  });
});

describe('mock ledger: cap boundary', () => {
  it('allows a reservation that lands exactly on the cap', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    expect((await ledger.reserve(1)).ok).toBe(true);
  });

  it('refuses one micro-USD over the cap as budget-exhausted', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const r = await ledger.reserve(1.000001);
    expect(r).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    expect(ledger.refusals).toBe(1);
    expect(ledger.reservations).toBe(0);
  });

  it('counts outstanding and spent together against the cap', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const a = await ledger.reserve(0.6);
    if (!a.ok) throw new Error('expected grant');
    await ledger.reconcile(a.value.reservationId, 0.5);
    expect((await ledger.reserve(0.5)).ok).toBe(true);
    expect((await ledger.reserve(0.000001)).ok).toBe(false);
  });

  it('a zero cap refuses any positive reservation but allows zero', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 0 });
    expect((await ledger.reserve(0.000001)).ok).toBe(false);
    expect((await ledger.reserve(0)).ok).toBe(true);
  });
});

describe('mock ledger: fault injection', () => {
  it('refuseAfter grants N reservations then refuses with budget-exhausted', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 100, refuseAfter: 2 });
    expect((await ledger.reserve(0.01)).ok).toBe(true);
    expect((await ledger.reserve(0.01)).ok).toBe(true);
    const third = await ledger.reserve(0.01);
    expect(third).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    expect(ledger.reservations).toBe(2);
    expect(ledger.refusals).toBe(1);
  });

  it('refuseAfter: 0 refuses the first reserve', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 100, refuseAfter: 0 });
    const r = await ledger.reserve(0.01);
    expect(r).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
  });

  it('refuseAfter does not stop reconcile or release of granted reservations', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 100, refuseAfter: 1 });
    const r = await ledger.reserve(0.01);
    if (!r.ok) throw new Error('expected grant');
    expect((await ledger.reserve(0.01)).ok).toBe(false);
    expect((await ledger.reconcile(r.value.reservationId, 0.01)).ok).toBe(true);
  });

  it('unavailable returns ledger-unavailable from every method', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 100, unavailable: true });
    const down = { ok: false, error: { kind: 'ledger-unavailable' } };
    expect(await ledger.reserve(0.01)).toEqual(down);
    expect(await ledger.reconcile('mock-res-1', 0.01)).toEqual(down);
    expect(await ledger.release('mock-res-1')).toEqual(down);
    expect(ledger.reservations).toBe(0);
    expect(ledger.refusals).toBe(1);
  });
});

describe('mock ledger: typed errors, no throws', () => {
  it('reconcile and release on an unknown id return typed errors', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const rec = await ledger.reconcile('nope', 0.1);
    const rel = await ledger.release('nope');
    expect(rec.ok).toBe(false);
    expect(rel.ok).toBe(false);
    if (!rec.ok) expect(['budget-exhausted', 'ledger-unavailable']).toContain(rec.error.kind);
    if (!rel.ok) expect(['budget-exhausted', 'ledger-unavailable']).toContain(rel.error.kind);
    expect(ledger.reconciles).toBe(0);
    expect(ledger.releases).toBe(0);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'reserve(%s) is refused without throwing or reserving',
    async (amount) => {
      const ledger = makeMockLedger({ dailyCapUsd: 1 });
      const r = await ledger.reserve(amount);
      expect(r.ok).toBe(false);
      expect(ledger.reservations).toBe(0);
      expect(ledger.outstandingMicroUsd).toBe(0);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'reconcile with actual %s returns an error and records no spend',
    async (amount) => {
      const ledger = makeMockLedger({ dailyCapUsd: 1 });
      const r = await ledger.reserve(0.5);
      if (!r.ok) throw new Error('expected grant');
      const rec = await ledger.reconcile(r.value.reservationId, amount);
      expect(rec.ok).toBe(false);
      expect(ledger.spentMicroUsd).toBe(0);
      expect(ledger.reconciles).toBe(0);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'a cap of %s refuses every positive reservation',
    async (cap) => {
      const ledger = makeMockLedger({ dailyCapUsd: cap });
      expect((await ledger.reserve(0.01)).ok).toBe(false);
    },
  );
});

describe('countingProvider', () => {
  it('counts calls and passes results through', async () => {
    const p = countingProvider(okProvider);
    expect(p.calls).toBe(0);
    expect(await p.complete(request)).toEqual(success);
    expect(p.calls).toBe(1);
  });

  it('turns an inner throw into a provider-error failure and still counts the call', async () => {
    const p = countingProvider({
      complete: async () => {
        throw new Error('boom');
      },
    });
    const r = await p.complete(request);
    expect(r).toEqual({ ok: false, error: { kind: 'provider-error', retryable: false } });
    expect(p.calls).toBe(1);
  });
});

describe('calling stage with the mock ledger (local callWithBudget)', () => {
  it('reserves, calls, reconciles on success', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const p = countingProvider(okProvider);
    const out = await callWithBudget(ledger, p, request, 0.2);
    expect(out.ok).toBe(true);
    expect(p.calls).toBe(1);
    expect(ledger.reconciles).toBe(1);
    expect(ledger.outstandingMicroUsd).toBe(0);
    expect(ledger.spentMicroUsd).toBe(100_000);
  });

  it('releases the reservation when the provider fails', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1 });
    const p = countingProvider(failingProvider);
    const out = await callWithBudget(ledger, p, request, 0.2);
    expect(out).toEqual({ ok: false, reason: 'provider-failed' });
    expect(ledger.releases).toBe(1);
    expect(ledger.reconciles).toBe(0);
    expect(ledger.outstandingMicroUsd).toBe(0);
    expect(ledger.spentMicroUsd).toBe(0);
  });

  it('budget-exhausted makes no provider call', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1, refuseAfter: 0 });
    const p = countingProvider(okProvider);
    const out = await callWithBudget(ledger, p, request, 0.2);
    expect(out).toEqual({ ok: false, reason: 'budget-exhausted' });
    expect(p.calls).toBe(0);
  });

  it('ledger-unavailable makes no provider call and stops the stage like budget-exhausted', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 1, unavailable: true });
    const p = countingProvider(okProvider);
    const out = await callWithBudget(ledger, p, request, 0.2);
    expect(out).toEqual({ ok: false, reason: 'ledger-unavailable' });
    expect(p.calls).toBe(0);
    expect(ledger.reservations).toBe(0);
  });

  it('over-cap worst case makes no provider call', async () => {
    const ledger = makeMockLedger({ dailyCapUsd: 0.1 });
    const p = countingProvider(okProvider);
    const out = await callWithBudget(ledger, p, request, 0.2);
    expect(out.ok).toBe(false);
    expect(p.calls).toBe(0);
  });
});
