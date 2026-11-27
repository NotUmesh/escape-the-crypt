import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boundThreadsArb } from '../../test-support/lock-interaction-arbitraries';
import { judge } from '../bound-threads';
import type { BoundThreadsQuestion } from '../bound-threads';
import { boundThreadsSubmission, initBoundThreadsDraft, selectLeft, tieRight, undoThread } from './bound-threads-interaction';
import type { BoundThreadsDraft } from './bound-threads-interaction';
import * as moduleExports from './bound-threads-interaction';

function tie(draft: BoundThreadsDraft, left: string, right: string): BoundThreadsDraft {
  const result = tieRight(selectLeft(draft, left), right);
  return result.ok ? result.draft : draft;
}
function tieAll(draft: BoundThreadsDraft, pairs: readonly (readonly [string, string])[]): BoundThreadsDraft {
  return pairs.reduce((d, [l, r]) => (d.pairs.some(([x]) => x === l) ? d : tie(d, l, r)), draft);
}
function answer(d: BoundThreadsDraft): { pairs: readonly (readonly [string, string])[] } {
  const s = boundThreadsSubmission(d);
  return s.ready ? s.submission : { pairs: [] };
}

describe('bound threads interaction', () => {
  it('Property 1: tying every key pair is correct, another full matching is wrong', () => {
    fc.assert(
      fc.property(boundThreadsArb, ({ question, hint, seed }) => {
        const start = initBoundThreadsDraft(question, hint, seed);
        const solved = tieAll(start, question.keyPairs);
        expect(boundThreadsSubmission(solved).ready).toBe(true);
        expect(judge(question, answer(solved), hint)).toBe('correct');
        const shifted = question.leftIds.map((l, i) => [l, question.rightIds[(i + 1) % question.rightIds.length] ?? ''] as const);
        const hintedPair = start.hintedPair;
        const wrongPairs = hintedPair === null ? shifted : [hintedPair, ...shifted.filter(([l]) => l !== hintedPair[0])];
        const used = new Set(wrongPairs.map(([, r]) => r));
        if (used.size === wrongPairs.length && wrongPairs.length === question.leftIds.length) {
          const wrong = tieAll(start, wrongPairs);
          const j = judge(question, answer(wrong), hint);
          expect(j).not.toBe('invalid');
        }
      }),
    );
  });
  it('Property 2: stays one-to-one under any sequence of operations, and the hinted pair stays', () => {
    const op = fc.record({ kind: fc.constantFrom('left', 'right', 'undo'), index: fc.nat({ max: 7 }) });
    fc.assert(
      fc.property(boundThreadsArb, fc.array(op, { maxLength: 40 }), ({ question, hint, seed }, ops) => {
        let d = initBoundThreadsDraft(question, hint, seed);
        for (const o of ops) {
          if (o.kind === 'left') d = selectLeft(d, question.leftIds[o.index % question.leftIds.length] ?? '');
          else if (o.kind === 'right') {
            const r = tieRight(d, question.rightIds[o.index % question.rightIds.length] ?? '');
            if (r.ok) d = r.draft;
          } else d = undoThread(d, question.leftIds[o.index % question.leftIds.length] ?? '');
          expect(new Set(d.pairs.map(([l]) => l)).size).toBe(d.pairs.length);
          expect(new Set(d.pairs.map(([, r]) => r)).size).toBe(d.pairs.length);
          if (d.hintedPair !== null) expect(d.pairs).toContainEqual(d.hintedPair);
        }
      }),
    );
  });
  it('Property 3: no right item starts on its key partner row', () => {
    fc.assert(
      fc.property(boundThreadsArb, ({ question, hint, seed }) => {
        const d = initBoundThreadsDraft(question, hint, seed);
        expect([...d.rightOrder].sort()).toEqual([...question.rightIds].sort());
        const partner = new Map(question.keyPairs.map(([l, r]) => [l, r]));
        expect(d.leftIds.some((l, i) => partner.get(l) === d.rightOrder[i])).toBe(false);
      }),
    );
  });
  const q: BoundThreadsQuestion = { leftIds: ['l0', 'l1'], rightIds: ['r0', 'r1'], keyPairs: [['l0', 'r0'], ['l1', 'r1']] };
  it('refuses a right item when no left item is picked, and a right item that is tied', () => {
    const d = initBoundThreadsDraft(q, null, 's');
    expect(tieRight(d, 'r0')).toEqual({ ok: false, refusal: 'no-left-selected' });
    const tied = tie(d, 'l0', 'r0');
    expect(tieRight(selectLeft(tied, 'l1'), 'r0')).toEqual({ ok: false, refusal: 'already-tied' });
    expect(tieRight(d, 'nope')).toEqual({ ok: false, refusal: 'unknown-item' });
  });
  it('picks and unpicks a left item, and undoes a thread', () => {
    const d = selectLeft(initBoundThreadsDraft(q, null, 's'), 'l0');
    expect(d.selectedLeft).toBe('l0');
    expect(selectLeft(d, 'l0').selectedLeft).toBeNull();
    const tied = tie(d, 'l0', 'r1');
    expect(undoThread(tied, 'l0').pairs).toEqual([]);
    expect(boundThreadsSubmission(tied).ready).toBe(false);
  });
  it('does not undo the hinted thread', () => {
    const d = initBoundThreadsDraft(q, { kind: 'tie-thread', pair: ['l0', 'r0'] }, 's');
    expect(d.pairs).toEqual([['l0', 'r0']]);
    expect(undoThread(d, 'l0')).toBe(d);
  });
  it('exports nothing that returns the key', () => {
    expect(Object.keys(moduleExports).sort()).toEqual([
      'boundThreadsSubmission', 'initBoundThreadsDraft', 'isLeftTied', 'isRightTied', 'selectLeft', 'tieRight', 'undoThread',
    ]);
  });
});
