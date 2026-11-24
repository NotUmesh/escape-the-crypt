import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { JUDGE_RESULTS, anyAppliedHint } from '../test-support/judge-totality';
import { judge, type BoneOrderingQuestion } from './bone-ordering';

const question: BoneOrderingQuestion = {
  itemIds: ['a', 'b', 'c', 'd'],
  keyOrder: ['a', 'b', 'c', 'd'],
};

describe('bone-ordering judge', () => {
  it('judges the exact key correct', () => {
    expect(judge(question, { order: ['a', 'b', 'c', 'd'] }, null)).toBe('correct');
  });

  it('judges another permutation wrong', () => {
    expect(judge(question, { order: ['b', 'a', 'c', 'd'] }, null)).toBe('wrong');
  });

  it('judges duplicates, missing and unknown items invalid', () => {
    expect(judge(question, { order: ['a', 'a', 'c', 'd'] }, null)).toBe('invalid');
    expect(judge(question, { order: ['a', 'b', 'c'] }, null)).toBe('invalid');
    expect(judge(question, { order: ['a', 'b', 'c', 'x'] }, null)).toBe('invalid');
    expect(judge(question, { order: [] }, null)).toBe('invalid');
  });

  it('judges a move of the locked first bone invalid', () => {
    const hint = { kind: 'lock-first-bone', boneId: 'a' } as const;
    expect(judge(question, { order: ['b', 'a', 'c', 'd'] }, hint)).toBe('invalid');
    expect(judge(question, { order: ['a', 'b', 'c', 'd'] }, hint)).toBe('correct');
    expect(judge(question, { order: ['a', 'c', 'b', 'd'] }, hint)).toBe('wrong');
  });

  it('ignores hints of other kinds', () => {
    expect(judge(question, { order: ['b', 'a', 'c', 'd'] }, { kind: 'remove-option', optionId: 'a' })).toBe(
      'wrong',
    );
  });

  it('never throws on arbitrary orders and only returns correct for the key', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'x')), (order) => {
        const result = judge(question, { order }, null);
        expect(['correct', 'wrong', 'invalid']).toContain(result);
        expect(result === 'correct').toBe(order.join(',') === 'a,b,c,d');
      }),
    );
  });
});

describe('bone-ordering judge totality', () => {
  const questionArb: fc.Arbitrary<BoneOrderingQuestion> = fc
    .uniqueArray(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 6 })
    .chain((itemIds) =>
      fc.shuffledSubarray(itemIds, { minLength: itemIds.length }).map((keyOrder) => ({ itemIds, keyOrder })),
    );

  it('returns a JudgeResult and never throws for any submission and hint', () => {
    fc.assert(
      fc.property(questionArb, fc.anything(), anyAppliedHint, (q, submission, hint) => {
        expect(JUDGE_RESULTS).toContain(judge(q, submission as never, hint));
      }),
    );
  });

  it('treats null, undefined and wrong-typed fields as invalid', () => {
    for (const bad of [null, undefined, 5, 'abcd', [], { order: 'abcd' }, { order: [1, 2, 3, 4] }, {}]) {
      expect(judge(question, bad as never, null)).toBe('invalid');
    }
    expect(judge(question, { order: ['a', 'b', 'c', 'd'] }, undefined as unknown as null)).toBe('correct');
  });
});
