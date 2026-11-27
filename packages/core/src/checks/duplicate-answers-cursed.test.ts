import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CryptContentEntry } from '../mapper/crypt-content';
import type { QuestionSpec } from '../runtime/manifest-types';
import { answerKey, answerKeysOf, answerKeysOfAuthoring, duplicateAnswerScan, keyedSpec } from './duplicate-answers';

const word = fc.stringMatching(/^[a-z]{3,10}$/);
const itemText = fc.tuple(word, word).map(([a, b]) => `${a} ${b}`);
/** The same item written differently: case, a leading article, trailing punctuation, hyphen for space. */
const respelled = (text: string, style: number): string =>
  [text.toUpperCase(), `The ${text}.`, text.replace(' ', '-'), ` ${text} `][style % 4] ?? text;

const authoring = (id: string, answer: string) => ({
  lockType: 'cursed-object' as const,
  answer,
  items: [answer, 'x1', 'x2', 'x3'],
  id,
});

function published(id: string, item: string): { spec: QuestionSpec; content: CryptContentEntry } {
  const optionIds = [0, 1, 2, 3].map((i) => `${id}-item-${i}`);
  const spec = {
    questionId: id,
    lockType: 'cursed-object',
    payload: { optionIds, oddOneOutId: optionIds[0] },
    evidenceRefs: ['c1'],
    hintEffect: null,
  } as unknown as QuestionSpec;
  const options = Object.fromEntries(optionIds.map((o, i) => [o, i === 0 ? item : `other ${i}`]));
  return { spec, content: { options } as unknown as CryptContentEntry };
}

const reported = (failures: readonly { checkId: string }[]) =>
  failures.filter((f) => f.checkId === 'duplicate-answer-in-room').length;

describe('cursed-object duplicate-answer keys', () => {
  // Feature: generation-and-evaluation, Property 5.33.10: cursed items equal after normalisation clash across concepts; different ones do not (design numbers no duplicate-answer property)
  // **Validates: Requirements 22.3, 12.2, 16.3**
  it('reports a clash across concepts exactly when the normalised cursed items are equal', () => {
    fc.assert(
      fc.property(itemText, itemText, fc.nat(), (a, b, style) => {
        const same = respelled(a, style);
        const scan = (x: string, y: string) =>
          duplicateAnswerScan([
            { conceptId: 'c1', questionId: 'q1', keys: answerKeysOfAuthoring(authoring('q1', x)) },
            { conceptId: 'c2', questionId: 'q2', keys: answerKeysOfAuthoring(authoring('q2', y)) },
          ]);
        expect(reported(scan(a, same))).toBe(2);

        const p1 = published('q1', a);
        const p2 = published('q2', same);
        expect(
          reported(duplicateAnswerScan([keyedSpec('c1', p1.spec, p1.content), keyedSpec('c2', p2.spec, p2.content)])),
        ).toBe(2);

        fc.pre(answerKey(a) !== answerKey(b));
        expect(reported(scan(a, b))).toBe(0);
        const p3 = published('q3', b);
        expect(
          reported(duplicateAnswerScan([keyedSpec('c1', p1.spec, p1.content), keyedSpec('c2', p3.spec, p3.content)])),
        ).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('gives one key from the cursed item and none when the item text is missing', () => {
    const p = published('q', 'The Rusty Key.');
    expect(answerKeysOf(p.spec, p.content)).toEqual(['rusty key']);
    expect(answerKeysOf(p.spec, undefined)).toEqual([]);
    expect(answerKeysOfAuthoring(authoring('q', 'The Rusty Key.'))).toEqual(['rusty key']);
  });
});
