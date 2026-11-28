import { LOCK_TYPES, type LockType, type Result } from '@escape-the-crypt/core';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Returned by `parseDisabledLockTypes` when any entry in the raw value is not
 * one of the six canonical Lock_Types. The raw value and the offending entry
 * are intentionally absent from the error to prevent user content leaking into
 * logs (Requirement 25.8).
 */
export type DisabledFlagsError = {
  readonly kind: 'unknown-lock-type';
  /** Always 'DISABLED_LOCK_TYPES' — names the variable without echoing its value. */
  readonly variableName: 'DISABLED_LOCK_TYPES';
};

/**
 * Returned by `effectiveLockTypes` when fewer than two types would remain after
 * removing the disabled ones. A room requires two different lock types (D1
 * decision: refuse to operate rather than produce nothing).
 */
export type TooFewLocksError = {
  readonly kind: 'too-few-lock-types';
  /** Number of types that would remain (0 or 1). */
  readonly count: number;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parses the raw value of the `DISABLED_LOCK_TYPES` environment variable.
 *
 * Rules:
 * - `undefined`, empty string or whitespace-only → `Ok([])`
 * - Comma-separated; each entry is trimmed and lower-cased before comparison.
 * - Empty entries (from leading/trailing commas or consecutive commas) are dropped.
 * - Duplicates are de-duplicated (last wins in set semantics, order preserved by
 *   first occurrence).
 * - Any remaining entry that is not in `LOCK_TYPES` returns
 *   `{ kind: 'unknown-lock-type', variableName: 'DISABLED_LOCK_TYPES' }`.
 *   The raw value is NEVER included in the error.
 *
 * Never throws, never reads any environment variable directly.
 */
export function parseDisabledLockTypes(
  raw: string | undefined,
): Result<readonly LockType[], DisabledFlagsError> {
  if (raw === undefined || raw.trim() === '') {
    return { ok: true, value: [] };
  }

  const entries = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  // De-duplicate preserving first-occurrence order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    if (!seen.has(entry)) {
      seen.add(entry);
      unique.push(entry);
    }
  }

  // Validate every entry against the canonical set.
  const lockTypeSet: ReadonlySet<string> = new Set(LOCK_TYPES);
  for (const entry of unique) {
    if (!lockTypeSet.has(entry)) {
      return {
        ok: false,
        error: { kind: 'unknown-lock-type', variableName: 'DISABLED_LOCK_TYPES' },
      };
    }
  }

  return { ok: true, value: unique as LockType[] };
}

// ---------------------------------------------------------------------------
// Effective set
// ---------------------------------------------------------------------------

/**
 * Returns `all` minus `disabled`, preserving the original order of `all`.
 *
 * Returns `{ kind: 'too-few-lock-types', count }` when fewer than two types
 * would remain (D1 decision: the worker refuses to start rather than operate
 * with zero or one lock type, since a room requires two different types).
 *
 * Never throws.
 */
export function effectiveLockTypes(
  all: readonly LockType[],
  disabled: readonly LockType[],
): Result<readonly LockType[], TooFewLocksError> {
  const disabledSet = new Set<LockType>(disabled);
  const remaining = all.filter((t) => !disabledSet.has(t));

  if (remaining.length < 2) {
    return {
      ok: false,
      error: { kind: 'too-few-lock-types', count: remaining.length },
    };
  }

  return { ok: true, value: remaining };
}
