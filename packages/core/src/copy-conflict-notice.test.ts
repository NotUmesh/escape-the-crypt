import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES } from './copy';
import { conflictLeftOut, conflictNext, conflictPassage } from './copy-conflict';
import { CONFLICT_NOTICE_COPY } from './copy-conflict-notice';

const LEARNING_GAIN_CLAIMS = ['learn faster', 'learn more', 'improve your', 'better grades', 'retention', 'remember more', 'boost your'];

describe('conflict notice copy', () => {
  const texts = [
    CONFLICT_NOTICE_COPY.heading,
    CONFLICT_NOTICE_COPY.showPassages,
    CONFLICT_NOTICE_COPY.showPassagesFor('Tides'),
    CONFLICT_NOTICE_COPY.passages,
    conflictLeftOut('Tides'),
    conflictPassage(1),
    conflictPassage(2),
    conflictNext,
  ];

  it('uses no banned wording and makes no learning-gain claim', () => {
    for (const text of texts) {
      const lower = text.toLowerCase();
      expect([...BANNED_COPY_PHRASES, ...LEARNING_GAIN_CLAIMS].filter((term) => lower.includes(term.toLowerCase())), text).toEqual([]);
    }
  });

  it('names a disclosure so that its accessible name starts with its visible text', () => {
    expect(CONFLICT_NOTICE_COPY.showPassagesFor('Tides').startsWith(CONFLICT_NOTICE_COPY.showPassages)).toBe(true);
  });

  it('calls the passages a claim, not a fact: the sentence says "seem"', () => {
    expect(conflictLeftOut('Tides')).toContain('seem to say different things');
  });
});
