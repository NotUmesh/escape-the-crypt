import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { combinationDialArb } from '../../test-support/lock-interaction-arbitraries';
import { judge } from '../combination-dial';
import type { CombinationDialQuestion } from '../combination-dial';
import {
  combinationDialSubmission,
  initCombinationDialDraft,
  setTypedEntry,
  stepWheel,
  wheelCount,
  wheelsOf,
} from './combination-dial-interaction';
import type { CombinationDialDraft } from './combination-dial-interaction';
import * as moduleExports from './combination-dial-interaction';

const fmt = (n: number, hasTenths: boolean): string => (hasTenths ? n.toFixed(1) : String(Math.round(n)));
function accepted(q: CombinationDialQuestion): number {
  return q.kind === 'exact' ? (q.exactValue ?? 0) : q.kind === 'range' ? (q.min ?? 0) : (q.value ?? 0);
}
function answer(d: CombinationDialDraft): { rawInput: string } {
  const s = combinationDialSubmission(d);
  return s.ready ? s.submission : { rawInput: '' };
}
/** Builds the wanted text by stepping wheels only. */
function stepTo(draft: CombinationDialDraft, text: string): CombinationDialDraft {
  const target = wheelsOf(setTypedEntry(draft, text));
  let current = draft;
  target.forEach((wheel) => {
    for (let guard = 0; guard < 10 && (wheelsOf(current)[wheel.index]?.digit ?? 0) !== wheel.digit; guard += 1) {
      current = stepWheel(current, wheel.index, 'up');
    }
  });
  return current.text === '' ? stepWheel(stepWheel(current, 0, 'up'), 0, 'down') : current;
}

describe('combination dial interaction', () => {
  it('sizes the wheels from the stated numbers', () => {
    const exact = initCombinationDialDraft({ kind: 'exact', exactValue: 1455, unit: 'year' });
    expect([exact.integerWheels, exact.hasTenths]).toEqual([4, false]);
    const range = initCombinationDialDraft({ kind: 'range', min: 3, max: 7.5, unit: 'x' });
    expect([range.integerWheels, range.hasTenths]).toEqual([3, true]);
    const tol = initCombinationDialDraft({ kind: 'tolerance', value: 98, tolerance: 4, unit: 'x' });
    expect([tol.integerWheels, tol.hasTenths]).toEqual([3, false]);
  });
  it('Property 1: a value built by stepping wheels or typing is judged by the core judge', () => {
    fc.assert(
      fc.property(combinationDialArb, (question) => {
        const draft = initCombinationDialDraft(question);
        const good = fmt(accepted(question), draft.hasTenths);
        expect(judge(question, answer(setTypedEntry(draft, good)), null)).toBe('correct');
        expect(judge(question, answer(stepTo(draft, good)), null)).toBe('correct');
        const way = fmt(accepted(question) + 5000, draft.hasTenths);
        expect(judge(question, answer(setTypedEntry(draft, way)), null)).toBe('wrong');
      }),
    );
  });
  it('Property 5: wheels agree with the text, and a step up then down returns to the same digits', () => {
    const digitsText = fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 9 })).map(([i, t]) => `${i}.${t}`);
    fc.assert(
      fc.property(digitsText, fc.nat({ max: 3 }), (text, which) => {
        const base = { text: '', integerWheels: 3, hasTenths: true };
        const draft = setTypedEntry(base, text);
        const [intPart = '0', tenth = '0'] = text.split('.');
        expect(wheelsOf(draft).map((w) => w.digit).join('')).toBe(`${intPart.padStart(3, '0')}${tenth}`);
        const before = wheelsOf(draft).map((w) => w.digit);
        const after = wheelsOf(stepWheel(stepWheel(draft, which, 'up'), which, 'down')).map((w) => w.digit);
        expect(after).toEqual(before);
        const stepped = wheelsOf(stepWheel(draft, which, 'up')).map((w) => w.digit);
        stepped.forEach((d, i) => {
          if (i !== which) expect(d).toBe(before[i]);
        });
      }),
    );
  });
  it('wraps 9 to 0 and 0 to 9 on one wheel only and keeps a leading minus', () => {
    const d = { text: '-199', integerWheels: 3, hasTenths: false };
    expect(stepWheel(d, 2, 'up').text).toBe('-190');
    expect(stepWheel({ ...d, text: '-100' }, 1, 'down').text).toBe('-190');
  });
  it('is not ready for empty text, and refuses unknown wheels without throwing', () => {
    const d = initCombinationDialDraft({ kind: 'exact', exactValue: 12, unit: 'x' });
    expect(combinationDialSubmission(d).ready).toBe(false);
    expect(combinationDialSubmission(setTypedEntry(d, '  ')).ready).toBe(false);
    expect(stepWheel(d, 99, 'up')).toBe(d);
    expect(wheelsOf(setTypedEntry(d, 'abc')).every((w) => w.digit === 0)).toBe(true);
    expect(wheelCount(d)).toBe(3);
  });
  it('Property 7: is total', () => {
    fc.assert(
      fc.property(combinationDialArb, fc.string(), fc.integer({ min: -3, max: 12 }), (q, text, i) => {
        const d = setTypedEntry(initCombinationDialDraft(q), text);
        expect(() => combinationDialSubmission(stepWheel(d, i, 'down'))).not.toThrow();
      }),
    );
  });
  it('exports nothing that returns a stated number', () => {
    expect(Object.keys(moduleExports).sort()).toEqual([
      'combinationDialSubmission', 'initCombinationDialDraft', 'setTypedEntry', 'stepWheel', 'wheelCount', 'wheelsOf',
    ]);
  });
});
