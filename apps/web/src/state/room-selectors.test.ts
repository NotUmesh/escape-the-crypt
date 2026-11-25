import { describe, expect, it } from 'vitest';
import type { Event } from '@escape-the-crypt/core';
import { chosenOptionFor } from './room-selectors';

const submit = (slotId: string, submission: unknown): Event => ({ kind: 'AnswerSubmitted', slotId, submission });

describe('chosenOptionFor', () => {
  it('returns the id of an accepted séance submission', () => {
    expect(chosenOptionFor([submit('s1', { selectedOptionId: 'b' })], 's1')).toBe('b');
  });

  it('returns the latest submission when a slot has several', () => {
    const log = [submit('s1', { selectedOptionId: 'a' }), submit('s1', { selectedOptionId: 'c' })];
    expect(chosenOptionFor(log, 's1')).toBe('c');
  });

  it('ignores events of other slots and other kinds', () => {
    const log: Event[] = [
      submit('s1', { selectedOptionId: 'a' }),
      submit('s2', { selectedOptionId: 'z' }),
      { kind: 'HintUsed', slotId: 's1' },
      { kind: 'Skipped', slotId: 's1' },
    ];
    expect(chosenOptionFor(log, 's1')).toBe('a');
  });

  it('is undefined for an empty log', () => {
    expect(chosenOptionFor([], 's1')).toBeUndefined();
  });

  it('is undefined for a rune { text } submission', () => {
    expect(chosenOptionFor([submit('s1', { text: 'aorta' })], 's1')).toBeUndefined();
  });

  it('is undefined for malformed submissions and does not throw', () => {
    for (const bad of [null, undefined, 7, 'x', [], { selectedOptionId: 3 }]) {
      expect(chosenOptionFor([submit('s1', bad)], 's1')).toBeUndefined();
    }
  });

  it('does not return a rejected submission, which is absent from the log', () => {
    expect(chosenOptionFor([{ kind: 'HintUsed', slotId: 's1' }], 's1')).toBeUndefined();
  });
});
