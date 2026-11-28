// Feature: generation-and-evaluation, Property 38/39: flag parsing and effective lock-type set
import fc from 'fast-check';
import { LOCK_TYPES } from '@escape-the-crypt/core';
import { describe, expect, it } from 'vitest';

import { EVAL_ALLOWED_LOCK_TYPES } from './config';
import { effectiveLockTypes, parseDisabledLockTypes } from './lock-type-flags';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * `disabledListArb` — a fast-check arbitrary producing random subsets of the
 * six lock types serialised as a comma-separated string, with:
 *   - duplicates (some entries repeated)
 *   - surrounding spaces on individual entries
 *   - mixed case
 *   - empty entries interspersed (from extra commas or blank items)
 *
 * Also yields `undefined` and empty / whitespace-only strings as special cases.
 *
 * Property 38 — Validates: Requirements 25.3, 23.5
 */
const disabledListArb: fc.Arbitrary<{ raw: string | undefined; expected: readonly string[] }> = fc
  .array(fc.nat({ max: LOCK_TYPES.length - 1 }), { minLength: 0, maxLength: LOCK_TYPES.length * 2 })
  .chain((indices) => {
    // Build the canonical expected set (de-duped, in first-occurrence order).
    const seen = new Set<string>();
    const expected: string[] = [];
    for (const i of indices) {
      const lt = LOCK_TYPES[i]!;
      if (!seen.has(lt)) {
        seen.add(lt);
        expected.push(lt);
      }
    }

    if (indices.length === 0) {
      // Represent the empty case as undefined, empty string, or whitespace-only.
      return fc.constantFrom(
        { raw: undefined as string | undefined, expected: [] as string[] },
        { raw: '', expected: [] as string[] },
        { raw: '   ', expected: [] as string[] },
        { raw: ',,,', expected: [] as string[] },
      );
    }

    // For each selected index produce a noisy entry (spaces + mixed case).
    return fc
      .array(
        fc.nat({ max: 5 }).map((spaces) => ' '.repeat(spaces)),
        { minLength: indices.length, maxLength: indices.length },
      )
      .chain((leadings) =>
        fc
          .array(
            fc.nat({ max: 5 }).map((spaces) => ' '.repeat(spaces)),
            { minLength: indices.length, maxLength: indices.length },
          )
          .chain((trailings) =>
            fc
              .array(
                fc.boolean(),
                { minLength: indices.length * 4, maxLength: indices.length * 4 },
              )
              .map((upperBits) => {
                const entries: string[] = indices.map((i, pos) => {
                  const lt = LOCK_TYPES[i]!;
                  const mixed = [...lt]
                    .map((ch, ci) => (upperBits[pos * 4 + (ci % 4)] ? ch.toUpperCase() : ch))
                    .join('');
                  return `${leadings[pos]}${mixed}${trailings[pos]}`;
                });

                // Duplicate some entries and intersperse empty segments.
                const withDups = [...entries];
                // Repeat the first entry if there is one (adds a duplicate).
                if (entries.length > 0) withDups.push(entries[0]!);
                // Intersperse an empty entry.
                withDups.push('');

                const raw = withDups.join(',');
                return { raw, expected };
              }),
          ),
      );
  });

// ---------------------------------------------------------------------------
// Property 38: DISABLED_LOCK_TYPES parses to exactly the named set
// ---------------------------------------------------------------------------

describe('Property 38: DISABLED_LOCK_TYPES parses to exactly the named set, and rejects anything else', () => {
  it('any valid subset parses to exactly that subset (de-duped, trimmed, lowercased)', () => {
    // Validates: Requirements 25.3, 23.5
    fc.assert(
      fc.property(disabledListArb, ({ raw, expected }) => {
        const result = parseDisabledLockTypes(raw);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect([...result.value]).toEqual(expected);
        }
      }),
    );
  });

  it('an entry outside the six returns the typed error; the error contains no part of the input', () => {
    // Validates: Requirements 25.3, 25.8
    // Requirement 25.8: the raw env value is intentionally absent from the error.
    // Unknown entries are sentinels: 'zz' + >= 4 alphanumerics (length >= 6, no commas,
    // ASCII only so case-folding is stable). They are filtered so they cannot be a
    // substring of the fixed error text, nor equal a lock type. Short junk like 'me'
    // would legitimately match the fixed text ("unknown-lock-type") and false-positive.
    const fixedErrorText = JSON.stringify({
      kind: 'unknown-lock-type',
      variableName: 'DISABLED_LOCK_TYPES',
    }).toLowerCase();
    const unknownEntryArb = fc
      .stringMatching(/^[a-z0-9]{4,12}$/)
      .map((s) => `zz${s}`)
      .filter((s) => !fixedErrorText.includes(s))
      .filter((s) => !(LOCK_TYPES as readonly string[]).includes(s));

    // Combine a valid subset (possibly empty) with the unknown entry.
    const mixedArb = fc.tuple(
      fc.array(fc.nat({ max: LOCK_TYPES.length - 1 }), { maxLength: 3 }),
      unknownEntryArb,
    );

    fc.assert(
      fc.property(mixedArb, ([indices, unknown]) => {
        const known = indices.map((i) => LOCK_TYPES[i]!).join(',');
        const raw = known ? `${known},${unknown}` : unknown;

        const result = parseDisabledLockTypes(raw);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe('unknown-lock-type');
          expect(result.error.variableName).toBe('DISABLED_LOCK_TYPES');

          // The error must carry no part of the raw input (Requirement 25.8).
          // Check that each meaningful (length ≥ 2) trimmed entry does not appear in
          // the serialised error. Only the fixed variable name is allowed there.
          const errorJson = JSON.stringify(result.error);
          // The unknown sentinel can never occur in the fixed text, so any hit is a leak.
          expect(errorJson.toLowerCase()).not.toContain(unknown);
          expect(errorJson.toLowerCase()).not.toContain(raw.trim().toLowerCase());
        }
      }),
    );
  });

  it('a recognisable secret-looking value never appears in the error', () => {
    // Validates: Requirement 25.8
    for (const raw of ['SECRET-xyzzy-123', 'rune-cipher,SECRET-xyzzy-123', ' Secret-XYZZY-123 ,']) {
      const result = parseDisabledLockTypes(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const json = JSON.stringify(result.error).toLowerCase();
        expect(json).not.toContain('secret');
        expect(json).not.toContain('xyzzy');
        expect(json).not.toContain('123');
      }
    }
  });

  it('unset (undefined) returns ok []', () => {
    const result = parseDisabledLockTypes(undefined);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('empty string returns ok []', () => {
    const result = parseDisabledLockTypes('');
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('whitespace-only string returns ok []', () => {
    const result = parseDisabledLockTypes('   ');
    expect(result).toEqual({ ok: true, value: [] });
  });
});

// ---------------------------------------------------------------------------
// Property 39: The effective lock-type set is all types minus the disabled ones
// ---------------------------------------------------------------------------

describe('Property 39: The effective lock-type set is all types minus the disabled ones', () => {
  /** Arbitrary: a non-empty subset (array, possibly with duplicates) of LOCK_TYPES as LockType[]. */
  const lockTypeSubsetArb = fc
    .array(fc.nat({ max: LOCK_TYPES.length - 1 }), { minLength: 0, maxLength: LOCK_TYPES.length })
    .map((indices) => {
      const seen = new Set<number>();
      return indices
        .filter((i) => {
          if (seen.has(i)) return false;
          seen.add(i);
          return true;
        })
        .map((i) => LOCK_TYPES[i]!);
    });

  it('result preserves order of LOCK_TYPES minus disabled; too-few-lock-types when fewer than 2 remain', () => {
    // Validates: Requirements 14.9, 23.5
    fc.assert(
      fc.property(lockTypeSubsetArb, (disabled) => {
        const result = effectiveLockTypes(LOCK_TYPES, disabled);
        const disabledSet = new Set(disabled);
        const expected = LOCK_TYPES.filter((lt) => !disabledSet.has(lt));

        if (expected.length < 2) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.kind).toBe('too-few-lock-types');
            expect(result.error.count).toBe(expected.length);
          }
        } else {
          expect(result.ok).toBe(true);
          if (result.ok) {
            // Order matches LOCK_TYPES order; no disabled type present.
            expect([...result.value]).toEqual(expected);
            for (const lt of result.value) {
              expect(disabledSet.has(lt)).toBe(false);
            }
          }
        }
      }),
    );
  });

  it('no disabled type appears in the result', () => {
    // Validates: Requirements 14.9
    fc.assert(
      fc.property(lockTypeSubsetArb, (disabled) => {
        const result = effectiveLockTypes(LOCK_TYPES, disabled);
        if (result.ok) {
          const disabledSet = new Set(disabled);
          for (const lt of result.value) {
            expect(disabledSet.has(lt)).toBe(false);
          }
        }
      }),
    );
  });

  it('EVAL_ALLOWED_LOCK_TYPES equals the six types regardless of what DISABLED_LOCK_TYPES holds', () => {
    // Validates: Requirements 14.9, 23.5
    // The constant is computed at import time and is independent of env vars;
    // assert it equals all six types in canonical order.
    expect([...EVAL_ALLOWED_LOCK_TYPES]).toEqual([...LOCK_TYPES]);
  });
});
