import { describe, expect, it } from 'vitest';
import { ALLOWED_LOCK_TYPES, EVAL_ALLOWED_LOCK_TYPES } from './config';

// DEFAULT_ALLOWED_LOCK_TYPES is not exported from core's index; generation-prompt.test.ts asserts it stays at two types.
describe('lock type allow-lists', () => {
  it('keeps the learner-notes allow-list at the original two types', () => {
    expect(ALLOWED_LOCK_TYPES).toEqual(['rune-cipher', 'seance-board']);
  });

  it('allows bone-ordering and bound-threads for evaluation runs only, keeping the original types', () => {
    expect(EVAL_ALLOWED_LOCK_TYPES).toEqual([
      'rune-cipher',
      'seance-board',
      'bone-ordering',
      'bound-threads',
      'cursed-object',
      'combination-dial',
    ]);
    expect(EVAL_ALLOWED_LOCK_TYPES).toContain('bound-threads');
    expect(ALLOWED_LOCK_TYPES).not.toContain('bone-ordering');
    expect(ALLOWED_LOCK_TYPES).not.toContain('bound-threads');
  });

  it('allows cursed-object for evaluation runs only', () => {
    expect(EVAL_ALLOWED_LOCK_TYPES).toContain('cursed-object');
    expect(ALLOWED_LOCK_TYPES).not.toContain('cursed-object');
    expect(ALLOWED_LOCK_TYPES).not.toContain('combination-dial');
    expect(ALLOWED_LOCK_TYPES).toEqual(['rune-cipher', 'seance-board']);
  });
});
