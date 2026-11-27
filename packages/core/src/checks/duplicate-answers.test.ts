import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_CONTEXT,
  duplicateAnswerCase,
  runeMitochondria,
  seanceWithKey,
} from '../test-support/duplicate-answer-case';
import { answerKey, answerKeysOfAuthoring, duplicateAnswerScan } from './duplicate-answers';
import { runRoomChecks } from './run-checks';

const ids = (failures: readonly { checkId: string; questionId: string }[]) =>
  failures.filter((f) => f.checkId === 'duplicate-answer-in-room').map((f) => f.questionId).sort();

describe('answerKey', () => {
  it.each([
    ['A booster.', 'booster'],
    ['The  Left-Ventricle', 'left ventricle'],
    ['\u201Cmitochondria\u201D', 'mitochondria'],
    ['an \uFB01broin', 'fibroin'],
    ['Theory', 'theory'],
    ['the', 'the'],
  ])('%j -> %j', (input, key) => expect(answerKey(input)).toBe(key));

  it('keeps distinct answers distinct', () => {
    expect(answerKey('left ventricle')).not.toBe(answerKey('right ventricle'));
    expect(answerKey('5-10')).not.toBe(answerKey('510'));
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(answerKey(answerKey(s))).toBe(answerKey(s));
      }),
      { numRuns: 300 },
    );
  });
});

describe('duplicate-answer-in-room', () => {
  it('flags both questions when two concepts share a normalised answer', () => {
    expect(duplicateAnswerCase().map((f) => f.checkId)).toContain('duplicate-answer-in-room');
    const failures = runRoomChecks([runeMitochondria(), seanceWithKey('The mitochondria', 'c2', 'other')], DUPLICATE_CONTEXT);
    expect(ids(failures)).toEqual(['other', 'q']);
  });

  it("does not flag a concept's own alternate with the same answer", () => {
    const failures = runRoomChecks([runeMitochondria(), seanceWithKey('Mitochondria', 'c', 'q-alt', 'alternate')], DUPLICATE_CONTEXT);
    expect(ids(failures)).toEqual([]);
  });

  it('compares rune aliases too, and ignores distractor text', () => {
    const rune = { ...runeMitochondria(), aliases: ['powerhouse'] };
    expect(answerKeysOfAuthoring(rune)).toEqual(['mitochondria', 'powerhouse']);
    // "The nucleus" is a distractor here, not an answer, so it never clashes.
    const other = seanceWithKey('Powerhouse', 'c2', 'other');
    expect(answerKeysOfAuthoring(other)).toEqual(['powerhouse']);
    expect(ids(runRoomChecks([rune, other], DUPLICATE_CONTEXT))).toEqual(['other', 'q']);
    expect(ids(runRoomChecks([runeMitochondria(), seanceWithKey('The nucleus', 'c2', 'n')], DUPLICATE_CONTEXT))).toEqual([]);
  });

  it('the scan is order-independent', () => {
    const entries = [
      { conceptId: 'a', questionId: 'a1', keys: ['x'] },
      { conceptId: 'b', questionId: 'b1', keys: ['y', 'x'] },
      { conceptId: 'c', questionId: 'c1', keys: ['z'] },
    ];
    const sorted = (f: readonly { questionId: string }[]) => f.map((x) => x.questionId).sort();
    fc.assert(
      fc.property(fc.shuffledSubarray(entries, { minLength: 3, maxLength: 3 }), (shuffled) => {
        expect(sorted(duplicateAnswerScan(shuffled))).toEqual(['a1', 'b1']);
      }),
      { numRuns: 20 },
    );
  });
});
