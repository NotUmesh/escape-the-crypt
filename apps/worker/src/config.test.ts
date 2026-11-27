import { describe, expect, it } from 'vitest';
import { ALLOWED_LOCK_TYPES, EVAL_ALLOWED_LOCK_TYPES } from './config';

const ALL_SIX = ['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'];

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
