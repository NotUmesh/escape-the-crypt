import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cryptTargetFor, type LockType, type ProviderUsage, type RunLength } from '@escape-the-crypt/core';
import { costOfUsage, worstCaseUsd, type TokenPrices } from '../budget/interim-ledger';
import {
  EVAL_ALLOWED_LOCK_TYPES,
  GENERATION_TEMPERATURE,
  INPUT_TOKENS_BOUND,
  MAX_OUTPUT_TOKENS,
  PROVIDER_RETRY_LIMIT,
  PROVIDER_TIMEOUT_MS,
} from '../config';
import type { PipelineSettings } from '../http/job-runner';
import type { DevNote } from './run-dev-set';

/** Calls in flight per stage. Lower than production's 4 to stay clear of rate limits; digests do not depend on it. */
const EVAL_CONCURRENCY = 2;

export function positive(value: string | undefined): number | undefined {
  const n = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Exhaustive over the six Lock_Types: adding a type to core fails the type-check here. */
const LOCK_TYPE_NAMES: Readonly<Record<LockType, true>> = {
  'rune-cipher': true,
  'seance-board': true,
  'bone-ordering': true,
  'bound-threads': true,
  'cursed-object': true,
  'combination-dial': true,
};

export type LockTypeListError =
  | { readonly kind: 'invalid-lock-type'; readonly value: string }
  | { readonly kind: 'empty-lock-type-list' };

function isLockType(value: string): value is LockType {
  return Object.prototype.hasOwnProperty.call(LOCK_TYPE_NAMES, value);
}

/** Parses `--allowed-lock-types`. Absent means the evaluation default. Commas or spaces separate (PowerShell passes an unquoted `a,b` as `a b`). */
export function parseAllowedLockTypes(
  raw: string | undefined,
): { readonly ok: true; readonly value: readonly LockType[] } | { readonly ok: false; readonly error: LockTypeListError } {
  if (raw === undefined) return { ok: true, value: EVAL_ALLOWED_LOCK_TYPES };
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: { kind: 'empty-lock-type-list' } };
  const out: LockType[] = [];
  for (const part of parts) {
    if (!isLockType(part)) return { ok: false, error: { kind: 'invalid-lock-type', value: part } };
    if (!out.includes(part)) out.push(part);
  }
  return { ok: true, value: out };
}

export function settingsFor(modelId: string, prices: TokenPrices, allowedLockTypes: readonly LockType[] = EVAL_ALLOWED_LOCK_TYPES, length?: RunLength): PipelineSettings {
  return {
    ...(length === undefined ? {} : { target: cryptTargetFor(length) }),
    modelId,
    temperature: GENERATION_TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    retryLimit: PROVIDER_RETRY_LIMIT,
    worstCaseUsd: worstCaseUsd({ inputTokensEstimate: INPUT_TOKENS_BOUND, maxOutputTokens: MAX_OUTPUT_TOKENS }, prices),
    costOf: (usage: ProviderUsage) => costOfUsage(usage, prices),
    allowedLockTypes,
    concurrency: EVAL_CONCURRENCY,
  };
}

export function loadNotes(notesDir: string, only: string | undefined): DevNote[] {
  // Commas or spaces: PowerShell passes an unquoted `a,b` as `a b`.
  const wanted = only?.split(/[\s,]+/).filter(Boolean);
  return readdirSync(notesDir)
    .filter((n) => n.endsWith('.txt'))
    .filter((n) => wanted === undefined || wanted.some((w) => n.startsWith(w)))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(notesDir, name), 'utf8') }));
}
