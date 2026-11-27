import type { BudgetLedger, BudgetResult, ProviderUsage } from '@escape-the-crypt/core';

/**
 * Interim_Ledger: the Worker's in-memory daily spending cap, used until spec 6 provides the
 * Postgres ledger (Req 28).
 *
 * Caveats:
 * - The totals live in process memory. They reset when the Worker restarts, so a restart gives the
 *   day a fresh cap. This deviates from the transactional ledger in the security rule.
 * - The backstop is the monthly budget limit on the OpenAI project. Set one.
 *
 * Amounts cross the interface as USD numbers but are stored as integer micro-dollars, like the
 * mock ledger, so repeated adds and subtracts never drift. Reserve rounds up, reconcile rounds to
 * nearest.
 *
 * Concurrency: calls are async but the runtime is single-threaded, and there is no await between
 * the cap check and the update in `reserve`, so two concurrent reserves cannot both pass the cap.
 *
 * Day rollover: at the first call after UTC midnight, `spent` resets to zero. Reservations still
 * open stay counted against the new day until they are reconciled or released, so a late reconcile
 * still finds its ID. A reconcile that lands after midnight adds its cost to the new day's spend.
 */

const MICRO = 1_000_000;
const TOKENS_PER_MTOK = 1_000_000;
const CHARS_PER_TOKEN = 4;
const MS_PER_DAY = 86_400_000;

export interface TokenPrices {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
}

export interface InterimLedgerConfig {
  /** From `DAILY_BUDGET_USD`, via `parseDailyBudget`. A missing or non-positive value puts the ledger in refuse mode. */
  readonly dailyBudgetUsd: number | undefined;
  readonly prices: TokenPrices;
  /** Injected clock in epoch milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export type DailyBudgetResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: { readonly kind: 'budget-exhausted' } };

/**
 * Reads `DAILY_BUDGET_USD`. Missing, non-numeric, non-finite or <= 0 gives `budget-exhausted`
 * (Req 28.9), which the Worker surfaces on `POST /jobs` instead of crashing.
 */
export function parseDailyBudget(env: Readonly<Record<string, string | undefined>>): DailyBudgetResult {
  const raw = env['DAILY_BUDGET_USD']?.trim();
  if (raw === undefined || raw === '') return { ok: false, error: { kind: 'budget-exhausted' } };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: { kind: 'budget-exhausted' } };
  return { ok: true, value };
}

/**
 * Rough input-token estimate: characters / 4, rounded up. This is an estimate, not a tokenizer.
 * Callers should add headroom if their prompts contain many non-English or symbol-heavy tokens.
 */
export function estimateInputTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function validPrices(prices: TokenPrices): boolean {
  return (
    Number.isFinite(prices.inputUsdPerMTok) &&
    prices.inputUsdPerMTok >= 0 &&
    Number.isFinite(prices.outputUsdPerMTok) &&
    prices.outputUsdPerMTok >= 0
  );
}

function validTokens(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Worst-case cost of one call: estimated input tokens times the input price plus the requested
 * maximum output tokens times the output price (Req 28.3). Invalid inputs return `Infinity`, which
 * `reserve` refuses, so a bad price or token count fails closed.
 */
export function worstCaseUsd(
  call: { readonly inputTokensEstimate: number; readonly maxOutputTokens: number },
  prices: TokenPrices,
): number {
  if (!validPrices(prices) || !validTokens(call.inputTokensEstimate) || !validTokens(call.maxOutputTokens)) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    (call.inputTokensEstimate * prices.inputUsdPerMTok + call.maxOutputTokens * prices.outputUsdPerMTok) /
    TOKENS_PER_MTOK
  );
}

/** Actual cost from reported usage. Invalid inputs return `Infinity`, which `reconcile` rejects. */
export function costOfUsage(usage: ProviderUsage, prices: TokenPrices): number {
  return worstCaseUsd({ inputTokensEstimate: usage.inputTokens, maxOutputTokens: usage.outputTokens }, prices);
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

export function makeInterimLedger(config: InterimLedgerConfig): BudgetLedger {
  const now = config.now ?? Date.now;
  const cap = config.dailyBudgetUsd;
  const capMicro =
    cap !== undefined && Number.isFinite(cap) && cap > 0 ? Math.floor(cap * MICRO) : 0;
  const refuseMode = capMicro <= 0;

  const open = new Map<string, number>();
  let nextId = 1;
  let reserved = 0;
  let spent = 0;
  let currentDay = Math.floor(now() / MS_PER_DAY);

  /** Lazily rolls the UTC day. Open reservations stay counted. */
  function rollDay(): void {
    const day = Math.floor(now() / MS_PER_DAY);
    if (day !== currentDay) {
      currentDay = day;
      spent = 0;
    }
  }

  return {
    async reserve(worstCaseUsdAmount) {
      if (refuseMode || !validAmount(worstCaseUsdAmount)) return fail('budget-exhausted');
      rollDay();
      const micro = Math.ceil(worstCaseUsdAmount * MICRO);
      if (spent + reserved + micro > capMicro) return fail('budget-exhausted');
      const reservationId = `interim-res-${nextId}`;
      nextId += 1;
      open.set(reservationId, micro);
      reserved += micro;
      return ok({ reservationId, reservedUsd: micro / MICRO });
    },
    async reconcile(reservationId, actualUsd) {
      const held = open.get(reservationId);
      if (held === undefined || !validAmount(actualUsd)) return fail('ledger-unavailable');
      rollDay();
      open.delete(reservationId);
      reserved -= held;
      spent += Math.round(actualUsd * MICRO);
      return ok(undefined);
    },
    async release(reservationId) {
      const held = open.get(reservationId);
      if (held === undefined) return fail('ledger-unavailable');
      rollDay();
      open.delete(reservationId);
      reserved -= held;
      return ok(undefined);
    },
  };
}
