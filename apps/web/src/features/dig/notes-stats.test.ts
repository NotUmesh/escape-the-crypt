import { describe, expect, it } from 'vitest';
import type { Chunk } from '@escape-the-crypt/core';
import { notesStats } from './notes-stats';

const chunks = [{}, {}, {}] as unknown as readonly Chunk[];

describe('notesStats', () => {
  it('counts pieces and words', () => {
    expect(notesStats(chunks, 'one two\n\nthree  four five')).toEqual({ pieces: 3, words: 5 });
  });

  it('reads empty text as no words', () => {
    expect(notesStats([], '  \n ')).toEqual({ pieces: 0, words: 0 });
  });
});
