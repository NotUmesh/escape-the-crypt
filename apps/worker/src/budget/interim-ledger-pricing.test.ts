import { describe, it, expect } from 'vitest';
import {
  costOfUsage,
  estimateInputTokens,
  makeInterimLedger,
  parseDailyBudget,
  worstCaseUsd,
} from './interim-ledger';

const PRICES = { inputUsdPerMTok: 2, outputUsdPerMTok: 10 };
const LAST_MS_OF_DAY = Date.UTC(2025, 0, 1, 23, 59, 59, 999);

function ledgerWith(cap: number | undefined) {
  const now = () => LAST_MS_OF_DAY - 5000;
  return { ledger: makeInterimLedger({ dailyBudgetUsd: cap, prices: PRICES, now }) };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: { kind: string } }): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.kind}`);
  return r.value;
}

describe('parseDailyBudget (Req 28.2, 28.9)', () => {
  const refused = { ok: false, error: { kind: 'budget-exhausted' } };

  it.each([
    ['missing', {}],
    ['undefined', { DAILY_BUDGET_USD: undefined }],
    ['empty', { DAILY_BUDGET_USD: '' }],
    ['whitespace', { DAILY_BUDGET_USD: '   ' }],
    ['abc', { DAILY_BUDGET_USD: 'abc' }],
    ['0', { DAILY_BUDGET_USD: '0' }],
    ['-1', { DAILY_BUDGET_USD: '-1' }],
    ['Infinity', { DAILY_BUDGET_USD: 'Infinity' }],
    ['NaN', { DAILY_BUDGET_USD: 'NaN' }],
  ])('refuses %s', (_label, env) => {
    expect(parseDailyBudget(env)).toEqual(refused);
  });

  it('accepts "5"', () => {
    expect(parseDailyBudget({ DAILY_BUDGET_USD: '5' })).toEqual({ ok: true, value: 5 });
  });

  it('accepts a decimal value with surrounding whitespace', () => {
    expect(parseDailyBudget({ DAILY_BUDGET_USD: ' 2.5 ' })).toEqual({ ok: true, value: 2.5 });
  });
});

describe('Interim_Ledger refuse mode (Req 28.9)', () => {
  it.each([undefined, 0, -1, NaN, Infinity])('refuses every reserve when the cap is %s', async (cap) => {
    const { ledger } = ledgerWith(cap);
    for (const amount of [0, 0.000001, 1]) {
      expect(await ledger.reserve(amount)).toEqual({ ok: false, error: { kind: 'budget-exhausted' } });
    }
  });
});

describe('pricing helpers (Req 28.3)', () => {
  it('computes worst-case cost from input and output tokens', () => {
    // (1000 * 2 + 500 * 10) / 1e6 = 0.007
    expect(worstCaseUsd({ inputTokensEstimate: 1000, maxOutputTokens: 500 }, PRICES)).toBeCloseTo(0.007, 12);
    expect(worstCaseUsd({ inputTokensEstimate: 0, maxOutputTokens: 0 }, PRICES)).toBe(0);
  });

  it('computes actual cost from usage', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
    // 2 + 1 = 3 USD
    expect(costOfUsage(usage as Parameters<typeof costOfUsage>[0], PRICES)).toBeCloseTo(3, 12);
  });

  it('returns Infinity for invalid prices and the ledger refuses it', async () => {
    const call = { inputTokensEstimate: 10, maxOutputTokens: 10 };
    for (const bad of [
      { inputUsdPerMTok: NaN, outputUsdPerMTok: 1 },
      { inputUsdPerMTok: 1, outputUsdPerMTok: -1 },
      { inputUsdPerMTok: Infinity, outputUsdPerMTok: 1 },
    ]) {
      const cost = worstCaseUsd(call, bad);
      expect(cost).toBe(Infinity);
      const { ledger } = ledgerWith(1000);
      expect((await ledger.reserve(cost)).ok).toBe(false);
    }
  });

  it('returns Infinity for invalid token counts', () => {
    expect(worstCaseUsd({ inputTokensEstimate: -1, maxOutputTokens: 1 }, PRICES)).toBe(Infinity);
    expect(worstCaseUsd({ inputTokensEstimate: 1, maxOutputTokens: NaN }, PRICES)).toBe(Infinity);
  });

  it('rejects an Infinity actual cost on reconcile', async () => {
    const { ledger } = ledgerWith(1);
    const a = must(await ledger.reserve(0.5));
    const cost = costOfUsage(
      { inputTokens: NaN, outputTokens: 1 } as Parameters<typeof costOfUsage>[0],
      PRICES,
    );
    expect(cost).toBe(Infinity);
    expect((await ledger.reconcile(a.reservationId, cost)).ok).toBe(false);
  });
});

describe('estimateInputTokens', () => {
  it('rounds chars / 4 up', () => {
    expect(estimateInputTokens('')).toBe(0);
    expect(estimateInputTokens('a')).toBe(1);
    expect(estimateInputTokens('abcd')).toBe(1);
    expect(estimateInputTokens('abcde')).toBe(2);
    expect(estimateInputTokens('x'.repeat(401))).toBe(101);
  });
});

