import { describe, expect, it } from 'vitest';
import { ALLOWED_LOCK_TYPES, EVAL_ALLOWED_LOCK_TYPES } from './config';

describe('lock type allow-lists', () => {
  it('keeps the learner-notes allow-list at the original two types', () => {
    expect(ALLOWED_LOCK_TYPES).toEqual(['rune-cipher', 'seance-board']);
  });

  it('allows bone-ordering for evaluation runs only, keeping the original types', () => {
    expect(EVAL_ALLOWED_LOCK_TYPES).toEqual(['rune-cipher', 'seance-board', 'bone-ordering']);
    expect(ALLOWED_LOCK_TYPES).not.toContain('bone-ordering');
  });
});
