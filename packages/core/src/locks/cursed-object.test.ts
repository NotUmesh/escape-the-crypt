import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JUDGE_RESULTS, anyAppliedHint } from '../test-support/judge-totality';
import type { HintEffectSpec } from '../types';
import { judge, type CursedObjectQuestion } from './cursed-object';

const q: CursedObjectQuestion = { optionIds: ['a', 'b', 'c', 'd'], oddOneOutId: 'c' };
const remove = (optionId: string): HintEffectSpec => ({ kind: 'remove-option', optionId });

describe('cursed-object judge', () => {
  it('odd one out is correct', () => {
    expect(judge(q, { selectedId: 'c' }, null)).toBe('correct');
  });

  it('a listed non-odd object is wrong', () => {
    expect(judge(q, { selectedId: 'a' }, null)).toBe('wrong');
  });

  it('null and unlisted (stale) ids are invalid', () => {
    expect(judge(q, { selectedId: null }, null)).toBe('invalid');
    expect(judge(q, { selectedId: 'zzz' }, null)).toBe('invalid');
  });

  it('an object removed by an applied remove-option hint is invalid', () => {
    expect(judge(q, { selectedId: 'a' }, remove('a'))).toBe('invalid');
  });

  it('the same submission judges normally with no hint', () => {
    expect(judge(q, { selectedId: 'a' }, null)).toBe('wrong');
  });

  it('a hint removing another option does not affect judging', () => {
    expect(judge(q, { selectedId: 'a' }, remove('b'))).toBe('wrong');
    expect(judge(q, { selectedId: 'c' }, remove('b'))).toBe('correct');
  });

  it('other hint kinds are ignored', () => {
    const hints: HintEffectSpec[] = [
      { kind: 'lock-first-bone', boneId: 'a' },
      { kind: 'tie-thread', pair: ['a', 'b'] },
      { kind: 'reveal-digit', position: 0 },
    ];
    for (const h of hints) {
      expect(judge(q, { selectedId: 'a' }, h)).toBe('wrong');
      expect(judge(q, { selectedId: 'c' }, h)).toBe('correct');
    }
  });
});

describe('cursed-object judge totality', () => {
  const questionArb: fc.Arbitrary<CursedObjectQuestion> = fc
    .uniqueArray(fc.string({ minLength: 1 }), { minLength: 3, maxLength: 6 })
    .chain((optionIds) =>
      fc.constantFrom(...optionIds).map((oddOneOutId) => ({ optionIds, oddOneOutId })),
    );

  it('returns a JudgeResult and never throws for any submission and hint', () => {
    fc.assert(
      fc.property(questionArb, fc.anything(), anyAppliedHint, (question, submission, hint) => {
        expect(JUDGE_RESULTS).toContain(judge(question, submission as never, hint));
      }),
    );
  });

  it('treats null, undefined and wrong-typed fields as invalid', () => {
    for (const bad of [null, undefined, 5, 'c', [], { selectedId: 5 }, {}]) {
      expect(judge(q, bad as never, null)).toBe('invalid');
    }
    expect(judge(q, { selectedId: 'c' }, undefined as unknown as null)).toBe('correct');
  });
});
