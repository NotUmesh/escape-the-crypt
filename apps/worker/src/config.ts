import { MAX_EXTRACTED_WORDS, type LockType, type Result } from '@escape-the-crypt/core';
import { parseDailyBudget, worstCaseUsd, type TokenPrices } from './budget/interim-ledger';
import { isGeminiModelId } from './provider/gemini-provider';
import { parseDisabledLockTypes, effectiveLockTypes as effectiveLockTypesFromConfig, type DisabledFlagsError } from './lock-type-flags';

/**
 * Pipeline constants. The design names none of these, so they are conservative choices.
 * Review temperature is fixed at 0 inside core; this one is the generation and extraction value.
 */
export const GENERATION_TEMPERATURE = 0.2;
export const MAX_OUTPUT_TOKENS = 4096;
export const PROVIDER_TIMEOUT_MS = 60_000;
export const PROVIDER_RETRY_LIMIT = 1;
export const ALLOWED_LOCK_TYPES: readonly LockType[] = ['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'];
/** Lock types the evaluation CLI may request. Wider than ALLOWED_LOCK_TYPES, which the learner-notes path uses. */
export const EVAL_ALLOWED_LOCK_TYPES: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];

/**
 * Parsed once at module load from `process.env.DISABLED_LOCK_TYPES`.
 * Never throws. Errors carry no part of the env value (Requirement 25.8).
 */
export const parsedDisabledLockTypes: Result<LockType[], DisabledFlagsError> = parseDisabledLockTypes(
  process.env['DISABLED_LOCK_TYPES'],
) as Result<LockType[], DisabledFlagsError>;

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
  | { readonly kind: 'invalid-provider' }
  | { readonly kind: 'missing-api-key' }
  | { readonly kind: 'missing-web-origin' }
  | { readonly kind: 'missing-model' }
  | { readonly kind: 'missing-gemini-api-key' }
  | { readonly kind: 'invalid-gemini-model' }
  | { readonly kind: 'invalid-gemini-input-price' }
  | { readonly kind: 'invalid-gemini-output-price' }
  | { readonly kind: 'invalid-port' }
  | { readonly kind: 'invalid-job-ttl' }
  | { readonly kind: 'invalid-disabled-lock-types' }
  | { readonly kind: 'too-few-lock-types' }
  | { readonly kind: 'listen-failed' };

/** Fixed, value-free text for each startup error. Env values are never included. */
export const STARTUP_ERROR_COPY: Readonly<Record<StartupError['kind'], string>> = {
  'invalid-provider': 'PROVIDER must be openai or gemini (unset means openai)',
  'missing-api-key': 'OPENAI_API_KEY is not set',
  'missing-web-origin': 'WEB_ORIGIN is not set',
  'missing-model': 'OPENAI_MODEL is not set',
  'missing-gemini-api-key': 'PROVIDER is gemini but GEMINI_API_KEY is not set',
  'invalid-gemini-model': 'PROVIDER is gemini but GEMINI_MODEL is not set or is not a bare model ID such as gemini-3.8-flash',
  'invalid-gemini-input-price': 'PROVIDER is gemini but GEMINI_PRICE_INPUT_USD_PER_MTOK is not set or is not a positive number',
  'invalid-gemini-output-price': 'PROVIDER is gemini but GEMINI_PRICE_OUTPUT_USD_PER_MTOK is not set or is not a positive number',
  'invalid-port': 'PORT is not a valid port number',
  'invalid-job-ttl': 'JOB_TTL_MINUTES is not a positive number',
  'invalid-disabled-lock-types': 'DISABLED_LOCK_TYPES contains an unrecognised lock type',
  'too-few-lock-types': 'DISABLED_LOCK_TYPES leaves fewer than two lock types enabled',
  'listen-failed': 'the HTTP server could not listen on the configured port',
};

export const PROVIDER_NAMES = ['openai', 'gemini'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export interface WorkerConfig {
  /** From `PROVIDER`; `openai` when unset. The key, model and prices below belong to this provider. */
  readonly provider: ProviderName;
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
  /** Effective lock types after removing any `DISABLED_LOCK_TYPES` from `ALLOWED_LOCK_TYPES`. */
  readonly allowedLockTypes: readonly LockType[];
  /** Lock types removed by `DISABLED_LOCK_TYPES`. Empty when the variable is unset or empty. */
  readonly disabledLockTypes: readonly LockType[];
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

interface ProviderSettings {
  readonly provider: ProviderName;
  readonly apiKey: string;
  readonly modelId: string;
  readonly prices: TokenPrices | undefined;
  readonly warnings: readonly string[];
}

/**
 * OpenAI keeps its old rules: missing prices only refuse Jobs. Gemini is a manual fallback, so
 * every one of its four settings is checked here and a gap stops the worker at startup.
 * The other provider's settings are not read.
 */
function readProviderSettings(env: Env): Parsed<ProviderSettings> {
  const name = present(env['PROVIDER']) ?? 'openai';
  if (name === 'gemini') {
    const apiKey = present(env['GEMINI_API_KEY']);
    if (apiKey === undefined) return { ok: false, error: { kind: 'missing-gemini-api-key' } };
    const modelId = present(env['GEMINI_MODEL']);
    if (modelId === undefined || !isGeminiModelId(modelId)) return { ok: false, error: { kind: 'invalid-gemini-model' } };
    const input = positiveNumber(env['GEMINI_PRICE_INPUT_USD_PER_MTOK']);
    if (input === undefined) return { ok: false, error: { kind: 'invalid-gemini-input-price' } };
    const output = positiveNumber(env['GEMINI_PRICE_OUTPUT_USD_PER_MTOK']);
    if (output === undefined) return { ok: false, error: { kind: 'invalid-gemini-output-price' } };
    return { ok: true, value: { provider: 'gemini', apiKey, modelId, prices: { inputUsdPerMTok: input, outputUsdPerMTok: output }, warnings: [] } };
  }
  if (name !== 'openai') return { ok: false, error: { kind: 'invalid-provider' } };
  const apiKey = present(env['OPENAI_API_KEY']);
  if (apiKey === undefined) return { ok: false, error: { kind: 'missing-api-key' } };
  const modelId = present(env['OPENAI_MODEL']);
  if (modelId === undefined) return { ok: false, error: { kind: 'missing-model' } };
  const input = positiveNumber(env['PRICE_INPUT_USD_PER_MTOK']);
  const output = positiveNumber(env['PRICE_OUTPUT_USD_PER_MTOK']);
  const warnings: string[] = [];
  if (input === undefined) warnings.push('PRICE_INPUT_USD_PER_MTOK');
  if (output === undefined) warnings.push('PRICE_OUTPUT_USD_PER_MTOK');
  const prices = input !== undefined && output !== undefined ? { inputUsdPerMTok: input, outputUsdPerMTok: output } : undefined;
  return { ok: true, value: { provider: 'openai', apiKey, modelId, prices, warnings } };
}

export function readConfig(env: Env): Parsed<WorkerConfig> {
  const providerSettings = readProviderSettings(env);
  if (!providerSettings.ok) return providerSettings;
  const { provider, apiKey, modelId, prices } = providerSettings.value;
  const webOrigin = present(env['WEB_ORIGIN']);
  if (webOrigin === undefined) return { ok: false, error: { kind: 'missing-web-origin' } };

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

  // Parse and validate DISABLED_LOCK_TYPES. Errors carry no env value.
  const disabledParsed = parseDisabledLockTypes(env['DISABLED_LOCK_TYPES']);
  if (!disabledParsed.ok) {
    return { ok: false, error: { kind: 'invalid-disabled-lock-types' } };
  }
  const disabledLockTypes = disabledParsed.value;
  const effectiveResult = effectiveLockTypesFromConfig(ALLOWED_LOCK_TYPES, disabledLockTypes);
  if (!effectiveResult.ok) {
    return { ok: false, error: { kind: 'too-few-lock-types' } };
  }
  const allowedLockTypes = effectiveResult.value;

  const budget = parseDailyBudget(env);
  const dailyBudgetUsd = budget.ok ? budget.value : undefined;
  const warnings = [...(dailyBudgetUsd === undefined ? ['DAILY_BUDGET_USD'] : []), ...providerSettings.value.warnings];

  return {
    ok: true,
    value: {
      provider,
      apiKey,
      webOrigin,
      modelId,
      port,
      jobTtlMs: Math.round(jobTtlMinutes * 60_000),
      dailyBudgetUsd,
      prices,
      warnings,
      allowedLockTypes,
      disabledLockTypes,
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
