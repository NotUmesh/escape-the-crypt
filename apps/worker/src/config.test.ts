import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LOCK_TYPES,
  EVAL_ALLOWED_LOCK_TYPES,
  STARTUP_ERROR_COPY,
  parsedDisabledLockTypes,
  readConfig,
} from './config';

const ALL_SIX = ['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'];

const BASE_ENV = {
  OPENAI_API_KEY: 'sk-test',
  WEB_ORIGIN: 'http://localhost:5173',
  OPENAI_MODEL: 'gpt-4o',
};

// DEFAULT_ALLOWED_LOCK_TYPES is not exported from core's index; generation-prompt.test.ts asserts the same six types.
describe('lock type allow-lists', () => {
  it('allows all six lock types for learner notes, in order', () => {
    expect(ALLOWED_LOCK_TYPES).toEqual(ALL_SIX);
  });

  it('allows the same six lock types for evaluation runs', () => {
    expect(EVAL_ALLOWED_LOCK_TYPES).toEqual(ALL_SIX);
    expect(ALLOWED_LOCK_TYPES).toEqual(EVAL_ALLOWED_LOCK_TYPES);
  });
});

describe('parsedDisabledLockTypes', () => {
  it('is an ok Result (DISABLED_LOCK_TYPES is unset in the test environment)', () => {
    // The module-level constant is parsed once from process.env at import time.
    // In a test environment the variable is unset, so the result must be ok [].
    expect(parsedDisabledLockTypes.ok).toBe(true);
  });
});

describe('readConfig — DISABLED_LOCK_TYPES integration', () => {
  it('populates allowedLockTypes with all six types when the variable is unset', () => {
    const result = readConfig(BASE_ENV);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowedLockTypes).toEqual(ALL_SIX);
      expect(result.value.disabledLockTypes).toEqual([]);
    }
  });

  it('removes one disabled type from allowedLockTypes', () => {
    const result = readConfig({ ...BASE_ENV, DISABLED_LOCK_TYPES: 'bone-ordering' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowedLockTypes).toEqual([
        'rune-cipher', 'seance-board', 'bound-threads', 'cursed-object', 'combination-dial',
      ]);
      expect(result.value.disabledLockTypes).toEqual(['bone-ordering']);
    }
  });

  it('removes two disabled types, keeping the original order of the rest', () => {
    const result = readConfig({ ...BASE_ENV, DISABLED_LOCK_TYPES: ' Combination-Dial, seance-board ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.allowedLockTypes).toEqual(['rune-cipher', 'bone-ordering', 'bound-threads', 'cursed-object']);
      expect(result.value.disabledLockTypes).toEqual(['combination-dial', 'seance-board']);
    }
  });

  it('leaves exactly two types enabled without error (the boundary)', () => {
    const result = readConfig({ ...BASE_ENV, DISABLED_LOCK_TYPES: ALL_SIX.slice(2).join(',') });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.allowedLockTypes).toEqual(['rune-cipher', 'seance-board']);
  });

  it('treats an empty value like an unset one', () => {
    const result = readConfig({ ...BASE_ENV, DISABLED_LOCK_TYPES: '  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.disabledLockTypes).toEqual([]);
  });

  it('has fixed startup text that names the variable and never a value', () => {
    expect(STARTUP_ERROR_COPY['invalid-disabled-lock-types']).toContain('DISABLED_LOCK_TYPES');
    expect(STARTUP_ERROR_COPY['too-few-lock-types']).toContain('DISABLED_LOCK_TYPES');
  });

  it('returns invalid-disabled-lock-types for an unknown entry (error carries no env value)', () => {
    const result = readConfig({ ...BASE_ENV, DISABLED_LOCK_TYPES: 'not-a-lock-type' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-disabled-lock-types');
      expect(JSON.stringify(result.error)).not.toContain('not-a-lock-type');
    }
  });

  it('returns too-few-lock-types when fewer than two types remain', () => {
    // Disable five of six, leaving only one.
    const disabled = ALL_SIX.slice(0, 5).join(',');
    const result = readConfig({ ...BASE_ENV, DISABLED_LOCK_TYPES: disabled });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('too-few-lock-types');
    }
  });
});
