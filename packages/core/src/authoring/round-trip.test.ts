import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { authoringQuestionArb } from '../test-support/authoring-arbitraries';
import { parseAuthoringQuestion } from './parse';

describe('Authoring_Question round-trip', () => {
  // Feature: generation-and-evaluation, Property 1: Authoring_Question round-trip
  // Validates: Requirements 1.6
  it('parses, and survives JSON stringify/parse with equal value and option order', () => {
    fc.assert(
      fc.property(authoringQuestionArb, (question) => {
        const first = parseAuthoringQuestion(question);
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const second = parseAuthoringQuestion(JSON.parse(JSON.stringify(first.value)));
        expect(second.ok).toBe(true);
        if (!second.ok) return;

        expect(second.value).toEqual(first.value);
        if (first.value.lockType === 'seance-board' && second.value.lockType === 'seance-board') {
          expect(second.value.options.map((o) => o.id)).toEqual(first.value.options.map((o) => o.id));
        }
      }),
      { numRuns: 100 },
    );
  });
});
