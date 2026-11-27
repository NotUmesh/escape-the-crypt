import { MAX_EXTRACTED_WORDS, type LockType } from '@escape-the-crypt/core';
import { parseDailyBudget, worstCaseUsd, type TokenPrices } from './budget/interim-ledger';

/**
 * Pipeline constants. The design names none of these, so they are conservative choices.
 * Review temperature is fixed at 0 inside core; this one is the generation and extraction value.
 */
export const GENERATION_TEMPERATURE = 0.2;
export const MAX_OUTPUT_TOKENS = 4096;
export const PROVIDER_TIMEOUT_MS = 60_000;
export const PROVIDER_RETRY_LIMIT = 1;
export const ALLOWED_LOCK_TYPES: readonly LockType[] = ['rune-cipher', 'seance-board'];
/** Lock types the evaluation CLI may request. Wider than ALLOWED_LOCK_TYPES, which the learner-notes path uses. */
export const EVAL_ALLOWED_LOCK_TYPES: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];

/** Sweep cadence: the design requires at least once a minute. */
export const SWEEP_INTERVAL_MS = 60_000;

export const DEFAULT_PORT = 8787;
export const DEFAULT_JOB_TTL_MINUTES = 30;

/**
 * Per-call input-token bound: 2 tokens per word over the word cap (English prose is nearer 1.3, so
 * this is generous), plus a fixed allowance for the system prompt, schema and per-call instructions.
 */
export const TOKENS_PER_WORD_BOUND = 2;
export const PROMPT_OVERHEAD_TOKENS = 8_000;
export const INPUT_TOKENS_BOUND = MAX_EXTRACTED_WORDS * TOKENS_PER_WORD_BOUND + PROMPT_OVERHEAD_TOKENS;

export type Env = Readonly<Record<string, string | undefined>>;

export type StartupError =
  | { readonly kind: 'missing-api-key' }
  | { readonly kind: 'missing-web-origin' }
  | { readonly kind: 'missing-model' }
  | { readonly kind: 'invalid-port' }
  | { readonly kind: 'invalid-job-ttl' }
  | { readonly kind: 'listen-failed' };

/** Fixed, value-free text for each startup error. Env values are never included. */
export const STARTUP_ERROR_COPY: Readonly<Record<StartupError['kind'], string>> = {
  'missing-api-key': 'OPENAI_API_KEY is not set',
  'missing-web-origin': 'WEB_ORIGIN is not set',
  'missing-model': 'OPENAI_MODEL is not set',
  'invalid-port': 'PORT is not a valid port number',
  'invalid-job-ttl': 'JOB_TTL_MINUTES is not a positive number',
  'listen-failed': 'the HTTP server could not listen on the configured port',
};

export interface WorkerConfig {
  readonly apiKey: string;
  readonly webOrigin: string;
  readonly modelId: string;
  readonly port: number;
  readonly jobTtlMs: number;
  /** Undefined when `DAILY_BUDGET_USD` is missing or invalid: Jobs are refused. */
  readonly dailyBudgetUsd: number | undefined;
  /** Undefined when either price is missing or invalid: Jobs are refused. */
  readonly prices: TokenPrices | undefined;
  /** Names of optional settings that are missing or invalid. Names only, never values. */
  readonly warnings: readonly string[];
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

function positiveNumber(raw: string | undefined): number | undefined {
  const text = present(raw);
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StartupError };

export function readConfig(env: Env): Parsed<WorkerConfig> {
  const apiKey = present(env['OPENAI_API_KEY']);
  if (apiKey === undefined) return { ok: false, error: { kind: 'missing-api-key' } };
  const webOrigin = present(env['WEB_ORIGIN']);
  if (webOrigin === undefined) return { ok: false, error: { kind: 'missing-web-origin' } };
  const modelId = present(env['OPENAI_MODEL']);
  if (modelId === undefined) return { ok: false, error: { kind: 'missing-model' } };

  let port = DEFAULT_PORT;
  if (present(env['PORT']) !== undefined) {
    const parsed = Number(present(env['PORT']));
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
      return { ok: false, error: { kind: 'invalid-port' } };
    }
    port = parsed;
  }

  let jobTtlMinutes = DEFAULT_JOB_TTL_MINUTES;
  if (present(env['JOB_TTL_MINUTES']) !== undefined) {
    const parsed = positiveNumber(env['JOB_TTL_MINUTES']);
    if (parsed === undefined) return { ok: false, error: { kind: 'invalid-job-ttl' } };
    jobTtlMinutes = parsed;
  }

  const warnings: string[] = [];
  const budget = parseDailyBudget(env);
  const dailyBudgetUsd = budget.ok ? budget.value : undefined;
  if (dailyBudgetUsd === undefined) warnings.push('DAILY_BUDGET_USD');

  const input = positiveNumber(env['PRICE_INPUT_USD_PER_MTOK']);
  const output = positiveNumber(env['PRICE_OUTPUT_USD_PER_MTOK']);
  const prices = input !== undefined && output !== undefined ? { inputUsdPerMTok: input, outputUsdPerMTok: output } : undefined;
  if (input === undefined) warnings.push('PRICE_INPUT_USD_PER_MTOK');
  if (output === undefined) warnings.push('PRICE_OUTPUT_USD_PER_MTOK');

  return {
    ok: true,
    value: {
      apiKey,
      webOrigin,
      modelId,
      port,
      jobTtlMs: Math.round(jobTtlMinutes * 60_000),
      dailyBudgetUsd,
      prices,
      warnings,
    },
  };
}

/** True when Jobs may start: a valid daily budget and both prices. */
export function budgetConfigured(config: WorkerConfig): boolean {
  return config.dailyBudgetUsd !== undefined && config.prices !== undefined;
}

/** Worst-case cost of one call. Infinity (always refused) when the prices are not configured. */
export function configuredWorstCaseUsd(prices: TokenPrices | undefined): number {
  if (prices === undefined) return Number.POSITIVE_INFINITY;
  return worstCaseUsd({ inputTokensEstimate: INPUT_TOKENS_BOUND, maxOutputTokens: MAX_OUTPUT_TOKENS }, prices);
}
