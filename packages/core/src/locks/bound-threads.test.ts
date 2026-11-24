import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { JUDGE_RESULTS, anyAppliedHint } from '../test-support/judge-totality';
import type { ThreadPair } from '../types';
import { judge, type BoundThreadsQuestion } from './bound-threads';

const question: BoundThreadsQuestion = {
  leftIds: ['a', 'b', 'c'],
  rightIds: ['x', 'y', 'z'],
  keyPairs: [
    ['a', 'x'],
    ['b', 'y'],
    ['c', 'z'],
  ],
};

const key: readonly ThreadPair[] = question.keyPairs;

describe('bound-threads judge', () => {
  it('returns correct for the key set', () => {
    expect(judge(question, { pairs: key }, null)).toBe('correct');
  });

  it('ignores duplicate pairs', () => {
    expect(judge(question, { pairs: [...key, ['a', 'x']] }, null)).toBe('correct');
  });

  it('returns wrong when every left is tied once but not to the key', () => {
    const pairs: ThreadPair[] = [
      ['a', 'y'],
      ['b', 'x'],
      ['c', 'z'],
    ];
    expect(judge(question, { pairs }, null)).toBe('wrong');
  });

  it('returns invalid for an untied left item', () => {
    expect(judge(question, { pairs: key.slice(0, 2) }, null)).toBe('invalid');
    expect(judge(question, { pairs: [] }, null)).toBe('invalid');
  });

  it('returns invalid for unknown ids and for non one-to-one ties', () => {
    expect(judge(question, { pairs: [['a', 'x'], ['b', 'y'], ['c', 'q']] }, null)).toBe('invalid');
    expect(judge(question, { pairs: [['a', 'x'], ['b', 'x'], ['c', 'z']] }, null)).toBe('invalid');
    expect(judge(question, { pairs: [...key, ['a', 'y']] }, null)).toBe('invalid');
  });

  it('returns invalid when a pair tied by a tie-thread hint is missing', () => {
    const hint = { kind: 'tie-thread', pair: ['a', 'x'] } as const;
    const swapped: ThreadPair[] = [
      ['a', 'y'],
      ['b', 'x'],
      ['c', 'z'],
    ];
    expect(judge(question, { pairs: swapped }, hint)).toBe('invalid');
    expect(judge(question, { pairs: key }, hint)).toBe('correct');
  });

  it('ignores hints of other kinds', () => {
    expect(judge(question, { pairs: key }, { kind: 'remove-option', optionId: 'x' })).toBe('correct');
  });

  it('does not throw on malformed input', () => {
    expect(judge(question, { pairs: [['a']] } as never, null)).toBe('invalid');
    expect(judge(question, { pairs: null } as never, null)).toBe('invalid');
    expect(judge(question, undefined as never, null)).toBe('invalid');
  });

  it('gives the same result for the same pairs in any order', () => {
    // **Validates: Requirements 26.3, 26.4, 26.10**
    const pairArb = fc.tuple(
      fc.constantFrom('a', 'b', 'c', 'd'),
      fc.constantFrom('x', 'y', 'z', 'w'),
    );
    fc.assert(
      fc.property(
        fc.array(pairArb, { maxLength: 8 }),
        fc.nat(),
        (pairs, seed) => {
          const shuffled = [...pairs].sort((p, q) => ((pairKeyHash(p) + seed) % 7) - ((pairKeyHash(q) + seed) % 7));
          const reversed = [...pairs].reverse();
          const base = judge(question, { pairs }, null);
          expect(judge(question, { pairs: shuffled }, null)).toBe(base);
          expect(judge(question, { pairs: reversed }, null)).toBe(base);
        },
      ),
    );
  });
});

function pairKeyHash(p: ThreadPair): number {
  return p[0].charCodeAt(0) * 3 + p[1].charCodeAt(0);
}

describe('bound-threads judge totality', () => {
  const questionArb: fc.Arbitrary<BoundThreadsQuestion> = fc
    .uniqueArray(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 8 })
    .chain((ids) => {
      const half = Math.floor(ids.length / 2);
      const leftIds = ids.slice(0, half);
      const rightIds = ids.slice(half, half * 2);
      return fc
        .shuffledSubarray(rightIds, { minLength: rightIds.length })
        .map((shuffled) => ({
          leftIds,
          rightIds,
          keyPairs: leftIds.map((left, i): ThreadPair => [left, shuffled[i] ?? left]),
        }));
    });

  it('returns a JudgeResult and never throws for any submission and hint', () => {
    fc.assert(
      fc.property(questionArb, fc.anything(), anyAppliedHint, (q, submission, hint) => {
        expect(JUDGE_RESULTS).toContain(judge(q, submission as never, hint));
      }),
    );
  });

  it('treats null, undefined and wrong-typed fields as invalid', () => {
    for (const bad of [null, undefined, 5, 'ax', [], { pairs: 'ax' }, { pairs: [[1, 2]] }, {}]) {
      expect(judge(question, bad as never, null)).toBe('invalid');
    }
  });
});
