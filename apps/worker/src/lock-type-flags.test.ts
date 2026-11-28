import { LOCK_TYPES } from '@escape-the-crypt/core';
import { describe, expect, it } from 'vitest';
import {
  effectiveLockTypes,
  parseDisabledLockTypes,
  type DisabledFlagsError,
  type TooFewLocksError,
} from './lock-type-flags';

// ---------------------------------------------------------------------------
// parseDisabledLockTypes
// ---------------------------------------------------------------------------

describe('parseDisabledLockTypes', () => {
  describe('unset / empty → ok []', () => {
    it('returns ok [] for undefined', () => {
      const result = parseDisabledLockTypes(undefined);
      expect(result).toEqual({ ok: true, value: [] });
    });

    it('returns ok [] for empty string', () => {
      const result = parseDisabledLockTypes('');
      expect(result).toEqual({ ok: true, value: [] });
    });

    it('returns ok [] for whitespace-only string', () => {
      const result = parseDisabledLockTypes('   ');
      expect(result).toEqual({ ok: true, value: [] });
    });

    it('returns ok [] for a single comma (all empty entries)', () => {
      const result = parseDisabledLockTypes(',');
      expect(result).toEqual({ ok: true, value: [] });
    });

    it('returns ok [] for multiple commas with only spaces', () => {
      const result = parseDisabledLockTypes(' , , ');
      expect(result).toEqual({ ok: true, value: [] });
    });
  });

  describe('valid single entries', () => {
    it('parses rune-cipher', () => {
      const result = parseDisabledLockTypes('rune-cipher');
      expect(result).toEqual({ ok: true, value: ['rune-cipher'] });
    });

    it('parses seance-board', () => {
      const result = parseDisabledLockTypes('seance-board');
      expect(result).toEqual({ ok: true, value: ['seance-board'] });
    });

    it('parses bone-ordering', () => {
      const result = parseDisabledLockTypes('bone-ordering');
      expect(result).toEqual({ ok: true, value: ['bone-ordering'] });
    });

    it('parses bound-threads', () => {
      const result = parseDisabledLockTypes('bound-threads');
      expect(result).toEqual({ ok: true, value: ['bound-threads'] });
    });

    it('parses cursed-object', () => {
      const result = parseDisabledLockTypes('cursed-object');
      expect(result).toEqual({ ok: true, value: ['cursed-object'] });
    });

    it('parses combination-dial', () => {
      const result = parseDisabledLockTypes('combination-dial');
      expect(result).toEqual({ ok: true, value: ['combination-dial'] });
    });
  });

  describe('whitespace trimming', () => {
    it('trims leading/trailing spaces around a single entry', () => {
      const result = parseDisabledLockTypes('  rune-cipher  ');
      expect(result).toEqual({ ok: true, value: ['rune-cipher'] });
    });

    it('trims spaces around each entry in a list', () => {
      const result = parseDisabledLockTypes(' rune-cipher , seance-board ');
      expect(result).toEqual({ ok: true, value: ['rune-cipher', 'seance-board'] });
    });

    it('drops empty entries from leading/trailing commas', () => {
      const result = parseDisabledLockTypes(',rune-cipher,');
      expect(result).toEqual({ ok: true, value: ['rune-cipher'] });
    });

    it('drops empty entries from consecutive commas', () => {
      const result = parseDisabledLockTypes('rune-cipher,,seance-board');
      expect(result).toEqual({ ok: true, value: ['rune-cipher', 'seance-board'] });
    });
  });

  describe('case-insensitive', () => {
    it('accepts upper-case entry', () => {
      const result = parseDisabledLockTypes('RUNE-CIPHER');
      expect(result).toEqual({ ok: true, value: ['rune-cipher'] });
    });

    it('accepts mixed-case entry', () => {
      const result = parseDisabledLockTypes('Seance-Board');
      expect(result).toEqual({ ok: true, value: ['seance-board'] });
    });
  });

  describe('de-duplication', () => {
    it('removes a duplicate preserving first occurrence', () => {
      const result = parseDisabledLockTypes('rune-cipher,rune-cipher');
      expect(result).toEqual({ ok: true, value: ['rune-cipher'] });
    });

    it('removes duplicates from a longer list', () => {
      const result = parseDisabledLockTypes('rune-cipher,seance-board,rune-cipher,seance-board');
      expect(result).toEqual({ ok: true, value: ['rune-cipher', 'seance-board'] });
    });

    it('handles duplicate with different case', () => {
      const result = parseDisabledLockTypes('rune-cipher,RUNE-CIPHER');
      expect(result).toEqual({ ok: true, value: ['rune-cipher'] });
    });
  });

  describe('multiple valid entries', () => {
    it('parses two lock types', () => {
      const result = parseDisabledLockTypes('bone-ordering,cursed-object');
      expect(result).toEqual({ ok: true, value: ['bone-ordering', 'cursed-object'] });
    });

    it('parses all six lock types', () => {
      const all = LOCK_TYPES.join(',');
      const result = parseDisabledLockTypes(all);
      expect(result).toEqual({ ok: true, value: [...LOCK_TYPES] });
    });
  });

  describe('unknown entry → error without echoing the value', () => {
    it('rejects a completely unknown entry', () => {
      const result = parseDisabledLockTypes('not-a-lock-type');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unknown-lock-type');
        const err = result.error as DisabledFlagsError;
        expect(err.variableName).toBe('DISABLED_LOCK_TYPES');
        // The offending value must NOT appear in the error object.
        expect(JSON.stringify(result.error)).not.toContain('not-a-lock-type');
      }
    });

    it('rejects an entry that is a partial lock type name', () => {
      const result = parseDisabledLockTypes('rune');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unknown-lock-type');
      }
    });

    it('rejects a mixed list where one entry is invalid', () => {
      const result = parseDisabledLockTypes('rune-cipher,bad-type');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('unknown-lock-type');
        // Neither the raw value nor the bad entry must appear in the error.
        expect(JSON.stringify(result.error)).not.toContain('bad-type');
        expect(JSON.stringify(result.error)).not.toContain('rune-cipher,bad-type');
      }
    });

    it('error carries the variable name but never the value', () => {
      const rawValue = 'secret-lock-name-9999';
      const result = parseDisabledLockTypes(rawValue);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error as DisabledFlagsError;
        expect(err.variableName).toBe('DISABLED_LOCK_TYPES');
        expect(JSON.stringify(result.error)).not.toContain(rawValue);
      }
    });
  });

  describe('order preservation', () => {
    it('preserves input order for multiple entries', () => {
      const result = parseDisabledLockTypes('combination-dial,bone-ordering,rune-cipher');
      expect(result).toEqual({
        ok: true,
        value: ['combination-dial', 'bone-ordering', 'rune-cipher'],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// effectiveLockTypes
// ---------------------------------------------------------------------------

describe('effectiveLockTypes', () => {
  const all = [...LOCK_TYPES] as const;

  describe('no disabled types → returns all', () => {
    it('returns all six types when nothing is disabled', () => {
      const result = effectiveLockTypes(all, []);
      expect(result).toEqual({ ok: true, value: [...all] });
    });
  });

  describe('disabling subsets', () => {
    it('removes one disabled type, preserves order', () => {
      const result = effectiveLockTypes(all, ['rune-cipher']);
      expect(result).toEqual({
        ok: true,
        value: ['seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'],
      });
    });

    it('removes multiple disabled types, preserves remaining order', () => {
      const result = effectiveLockTypes(all, ['bone-ordering', 'cursed-object', 'combination-dial']);
      expect(result).toEqual({
        ok: true,
        value: ['rune-cipher', 'seance-board', 'bound-threads'],
      });
    });

    it('returns exactly two types when four are disabled', () => {
      const result = effectiveLockTypes(all, ['bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial']);
      expect(result).toEqual({ ok: true, value: ['rune-cipher', 'seance-board'] });
    });
  });

  describe('too-few-lock-types (D1: fewer than 2 remain)', () => {
    it('returns too-few-lock-types when exactly one type remains', () => {
      // Disable five of six → one remains.
      const disabled = [...LOCK_TYPES].slice(0, 5);
      const result = effectiveLockTypes(all, disabled as typeof LOCK_TYPES[number][]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error as TooFewLocksError;
        expect(err.kind).toBe('too-few-lock-types');
        expect(err.count).toBe(1);
      }
    });

    it('returns too-few-lock-types with count 0 when all types are disabled', () => {
      const result = effectiveLockTypes(all, [...LOCK_TYPES]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error as TooFewLocksError;
        expect(err.kind).toBe('too-few-lock-types');
        expect(err.count).toBe(0);
      }
    });

    it('count in error reflects actual remaining count', () => {
      // Disable all but one.
      const disabled = ['seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'] as const;
      const result = effectiveLockTypes(all, [...disabled]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as TooFewLocksError).count).toBe(1);
      }
    });
  });

  describe('disabled entries not in all → no effect', () => {
    it('a disabled type not in `all` is silently ignored (superset disable)', () => {
      // Supply only rune-cipher and seance-board in `all`.
      const twoTypes: readonly ('rune-cipher' | 'seance-board')[] = ['rune-cipher', 'seance-board'];
      // Disable something not in the list; still two in `all` → ok.
      const result = effectiveLockTypes(twoTypes, ['bone-ordering']);
      expect(result).toEqual({ ok: true, value: ['rune-cipher', 'seance-board'] });
    });
  });

  describe('order preservation', () => {
    it('preserves the original order from `all`, not from `disabled`', () => {
      // Disable the first; remaining should start from the second.
      const result = effectiveLockTypes(all, ['rune-cipher']);
      if (result.ok) {
        expect(result.value[0]).toBe('seance-board');
      }
    });
  });

  describe('idempotency', () => {
    it('calling with the same disabled set twice gives the same result', () => {
      const r1 = effectiveLockTypes(all, ['bone-ordering']);
      const r2 = effectiveLockTypes(all, ['bone-ordering']);
      expect(r1).toEqual(r2);
    });
  });
});
