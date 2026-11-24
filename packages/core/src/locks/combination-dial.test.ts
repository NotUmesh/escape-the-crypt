import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { JUDGE_RESULTS, anyAppliedHint } from '../test-support/judge-totality';
import { judge, type CombinationDialQuestion } from './combination-dial';

const range: CombinationDialQuestion = { kind: 'range', min: 60, max: 100, unit: 'bpm' };
const exact: CombinationDialQuestion = { kind: 'exact', exactValue: 21.5, unit: '°C' };
const tol: CombinationDialQuestion = { kind: 'tolerance', value: 21.5, tolerance: 0.5, unit: '°C' };
const tolZero: CombinationDialQuestion = { kind: 'tolerance', value: 21.5, tolerance: 0, unit: '°C' };
const j = (q: CombinationDialQuestion, rawInput: string) => judge(q, { rawInput }, null);

describe('combination-dial judge', () => {
  it('range is inclusive at both ends', () => {
    expect(j(range, '60')).toBe('correct');
    expect(j(range, '100')).toBe('correct');
    expect(j(range, ' 75 ')).toBe('correct');
  });

  it('range rejects values just outside', () => {
    expect(j(range, '59.9')).toBe('wrong');
    expect(j(range, '100.1')).toBe('wrong');
  });

  it('exact matches only the stated value', () => {
    expect(j(exact, '21.5')).toBe('correct');
    expect(j(exact, '21.4')).toBe('wrong');
  });

  it('tolerance bounds are inclusive without float error', () => {
    expect(j(tol, '21.0')).toBe('correct');
    expect(j(tol, '22.0')).toBe('correct');
    expect(j(tol, '22.1')).toBe('wrong');
    expect(j(tol, '20.9')).toBe('wrong');
  });

  it('tolerance 0 accepts only the value', () => {
    expect(j(tolZero, '21.5')).toBe('correct');
    expect(j(tolZero, '21.6')).toBe('wrong');
  });

  it('more than one decimal place is invalid for every kind', () => {
    expect(j(tol, '22.15')).toBe('invalid');
    expect(j(exact, '21.50')).toBe('invalid');
    expect(j(range, '60.05')).toBe('invalid');
  });

  it('non-numeric input is invalid', () => {
    for (const raw of ['', ' ', 'abc', '1e2', '12 bpm', '1,5', 'NaN', 'Infinity', '.']) {
      expect(j(range, raw)).toBe('invalid');
    }
  });

  it('negative numbers parse', () => {
    const q: CombinationDialQuestion = { kind: 'exact', exactValue: -3.5, unit: '°C' };
    expect(j(q, '-3.5')).toBe('correct');
  });

  it('a malformed question is invalid, not a throw', () => {
    expect(j({ kind: 'range', unit: '' }, '5')).toBe('invalid');
  });
});

describe('combination-dial judge totality', () => {
  const num = fc.double({ min: -1000, max: 1000, noNaN: true });
  const questionArb: fc.Arbitrary<CombinationDialQuestion> = fc.oneof(
    fc.record({ kind: fc.constant('exact' as const), exactValue: num, unit: fc.string() }),
    fc.record({ kind: fc.constant('range' as const), min: num, max: num, unit: fc.string() }),
    fc.record({
      kind: fc.constant('tolerance' as const),
      value: num,
      tolerance: num,
      unit: fc.string(),
    }),
  );

  it('returns a JudgeResult and never throws for any submission and hint', () => {
    fc.assert(
      fc.property(questionArb, fc.anything(), anyAppliedHint, (question, submission, hint) => {
        expect(JUDGE_RESULTS).toContain(judge(question, submission as never, hint));
      }),
    );
  });

  it('treats null, undefined and wrong-typed fields as invalid', () => {
    for (const bad of [null, undefined, 5, '70', [], { rawInput: 5 }, { rawInput: null }, {}]) {
      expect(judge(range, bad as never, null)).toBe('invalid');
    }
    expect(judge(range, { rawInput: '70' }, undefined as unknown as null)).toBe('correct');
  });
});
