import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JUDGE_RESULTS, anyAppliedHint } from '../test-support/judge-totality';
import type { HintEffectSpec } from '../types';
import { judge, type SeanceBoardQuestion } from './seance-board';

const question: SeanceBoardQuestion = { optionIds: ['a', 'b', 'c'], keyOptionId: 'b' };
const removeA: HintEffectSpec = { kind: 'remove-option', optionId: 'a' };

describe('seance-board judge', () => {
  it('judges key correct and other listed options wrong', () => {
    expect(judge(question, { selectedOptionId: 'b' }, null)).toBe('correct');
    expect(judge(question, { selectedOptionId: 'c' }, null)).toBe('wrong');
  });

  it('treats null and stale option IDs as invalid', () => {
    expect(judge(question, { selectedOptionId: null }, null)).toBe('invalid');
    expect(judge(question, { selectedOptionId: 'zzz' }, null)).toBe('invalid');
  });

  it('treats a hint-removed option as invalid, and judges it normally with no hint', () => {
    expect(judge(question, { selectedOptionId: 'a' }, removeA)).toBe('invalid');
    expect(judge(question, { selectedOptionId: 'a' }, null)).toBe('wrong');
  });

  it('still judges the key and other options normally under a remove-option hint', () => {
    expect(judge(question, { selectedOptionId: 'b' }, removeA)).toBe('correct');
    expect(judge(question, { selectedOptionId: 'c' }, removeA)).toBe('wrong');
  });

  it('ignores hints of other kinds', () => {
    const other: HintEffectSpec = { kind: 'lock-first-bone', boneId: 'a' };
    expect(judge(question, { selectedOptionId: 'a' }, other)).toBe('wrong');
  });
});

describe('seance-board judge totality', () => {
  const questionArb: fc.Arbitrary<SeanceBoardQuestion> = fc
    .uniqueArray(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 6 })
    .chain((optionIds) =>
      fc.constantFrom(...optionIds).map((keyOptionId) => ({ optionIds, keyOptionId })),
    );

  it('returns a JudgeResult and never throws for any submission and hint', () => {
    fc.assert(
      fc.property(questionArb, fc.anything(), anyAppliedHint, (q, submission, hint) => {
        expect(JUDGE_RESULTS).toContain(judge(q, submission as never, hint));
      }),
    );
  });

  it('treats null, undefined and wrong-typed fields as invalid', () => {
    for (const bad of [null, undefined, 5, 'b', [], { selectedOptionId: 5 }, {}]) {
      expect(judge(question, bad as never, null)).toBe('invalid');
    }
    expect(judge(question, { selectedOptionId: 'b' }, undefined as unknown as null)).toBe('correct');
  });
});
