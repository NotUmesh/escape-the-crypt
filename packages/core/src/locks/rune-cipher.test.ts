import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { JUDGE_RESULTS, anyAppliedHint } from '../test-support/judge-totality';
import { judge, type RuneCipherQuestion } from './rune-cipher';

const heart: RuneCipherQuestion = {
  answer: 'Atrioventricular',
  aliases: ['AV'],
  caseSensitive: false,
};
const sodium: RuneCipherQuestion = { answer: 'Na', aliases: [], caseSensitive: true };

describe('rune cipher judge', () => {
  it('trims and ignores case for the answer', () => {
    expect(judge(heart, { text: '  Atrioventricular ' }, null)).toBe('correct');
    expect(judge(heart, { text: 'ATRIOVENTRICULAR' }, null)).toBe('correct');
  });

  it('collapses internal whitespace runs', () => {
    const q: RuneCipherQuestion = { answer: 'sinoatrial node', aliases: [], caseSensitive: false };
    expect(judge(q, { text: 'sinoatrial \t  node' }, null)).toBe('correct');
  });

  it('accepts a reviewed alias', () => {
    expect(judge(heart, { text: 'AV' }, null)).toBe('correct');
  });

  it('rejects an unreviewed variant', () => {
    expect(judge(heart, { text: 'atrio-ventricular' }, null)).toBe('wrong');
  });

  it('respects case when flagged case-sensitive', () => {
    expect(judge(sodium, { text: 'NA' }, null)).toBe('wrong');
    expect(judge(sodium, { text: ' Na ' }, null)).toBe('correct');
  });

  it('returns invalid for empty or whitespace-only text', () => {
    expect(judge(heart, { text: '' }, null)).toBe('invalid');
    expect(judge(heart, { text: ' \t\n ' }, null)).toBe('invalid');
  });

  it('returns a typed result for any string and never throws', () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (text, caseSensitive) => {
        const result = judge({ ...heart, caseSensitive }, { text }, null);
        expect(['correct', 'wrong', 'invalid']).toContain(result);
      }),
    );
  });
});

describe('rune cipher judge totality', () => {
  const questionArb: fc.Arbitrary<RuneCipherQuestion> = fc.record({
    answer: fc.string({ minLength: 1 }),
    aliases: fc.array(fc.string()),
    caseSensitive: fc.boolean(),
  });

  it('returns a JudgeResult and never throws for any submission and hint', () => {
    fc.assert(
      fc.property(questionArb, fc.anything(), anyAppliedHint, (question, submission, hint) => {
        expect(JUDGE_RESULTS).toContain(judge(question, submission as never, hint));
      }),
    );
  });

  it('treats null, undefined and wrong-typed fields as invalid', () => {
    for (const bad of [null, undefined, 5, 'Na', [], { text: 5 }, { text: null }, {}]) {
      expect(judge(sodium, bad as never, null)).toBe('invalid');
    }
    expect(judge(sodium, { text: 'Na' }, undefined as unknown as null)).toBe('correct');
  });
});
