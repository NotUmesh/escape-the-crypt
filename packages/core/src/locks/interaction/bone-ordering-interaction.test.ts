import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { boneOrderingArb } from '../../test-support/lock-interaction-arbitraries';
import { judge } from '../bone-ordering';
import { applyBoneHint, boneOrderingSubmission, initBoneOrderingDraft, moveBone } from './bone-ordering-interaction';
import type { BoneOrderingDraft } from './bone-ordering-interaction';
import * as moduleExports from './bone-ordering-interaction';

function driveToKey(draft: BoneOrderingDraft, keyOrder: readonly string[]): BoneOrderingDraft {
  let current = draft;
  keyOrder.forEach((id, target) => {
    for (let guard = 0; guard < 50 && current.order.indexOf(id) > target && id !== current.pinnedId; guard += 1) {
      current = moveBone(current, id, 'up');
    }
  });
  return current;
}
const answerOf = (d: BoneOrderingDraft) => {
  const s = boneOrderingSubmission(d);
  return s.ready ? s.submission : { order: [] };
};

describe('bone ordering interaction', () => {
  it('Property 3: starts in an order that is not the key order, with the pinned bone in place', () => {
    fc.assert(
      fc.property(boneOrderingArb, ({ question, hint, seed }) => {
        const draft = initBoneOrderingDraft(question, hint, seed);
        expect([...draft.order].sort()).toEqual([...question.itemIds].sort());
        if (draft.pinnedId !== null) expect(draft.order.indexOf(draft.pinnedId)).toBe(question.keyOrder.indexOf(draft.pinnedId));
        if (question.itemIds.length - (draft.pinnedId === null ? 0 : 1) >= 3) expect(draft.order).not.toEqual(question.keyOrder);
      }),
    );
  });
  it('Property 1: the order built by moving is judged correct, and any other order is not', () => {
    fc.assert(
      fc.property(boneOrderingArb, ({ question, hint, seed }) => {
        const start = initBoneOrderingDraft(question, hint, seed);
        const solved = driveToKey(start, question.keyOrder);
        expect(solved.order).toEqual(question.keyOrder);
        expect(judge(question, answerOf(solved), hint)).toBe('correct');
        const first = question.keyOrder.find((id) => id !== solved.pinnedId) ?? '';
        const off = moveBone(solved, first, 'down');
        if (off.order.some((id, i) => id !== question.keyOrder[i])) {
          expect(judge(question, answerOf(off), hint)).not.toBe('correct');
          expect(judge(question, answerOf(off), hint)).not.toBe('invalid');
        }
      }),
    );
  });
  it('does not move past the ends, an unknown bone or the pinned bone', () => {
    const draft = initBoneOrderingDraft({ itemIds: ['a', 'b', 'c', 'd'], keyOrder: ['a', 'b', 'c', 'd'] }, { kind: 'lock-first-bone', boneId: 'a' }, 's');
    const first = draft.order[0] ?? '';
    expect(moveBone(draft, first, 'up')).toBe(draft);
    expect(moveBone(draft, draft.order[3] ?? '', 'down')).toBe(draft);
    expect(moveBone(draft, 'zzz', 'up')).toBe(draft);
    expect(moveBone(draft, 'a', 'down')).toBe(draft);
  });
  it('jumps over the pinned bone and leaves it where it was', () => {
    const base = { order: ['x', 'p', 'y'], pinnedId: 'p' } as const;
    expect(moveBone(base, 'x', 'down').order).toEqual(['y', 'p', 'x']);
    expect(moveBone(base, 'y', 'up').order).toEqual(['y', 'p', 'x']);
  });
  it('exports nothing that returns the key', () => {
    expect(Object.keys(moduleExports).sort()).toEqual(['applyBoneHint', 'boneOrderingSubmission', 'initBoneOrderingDraft', 'moveBone']);
  });
  it('Property 8: a hint used part way through an answer never makes the answer invalid', () => {
    const moves = fc.array(fc.tuple(fc.nat({ max: 9 }), fc.constantFrom('up', 'down')), { maxLength: 20 });
    fc.assert(
      fc.property(boneOrderingArb, fc.nat({ max: 9 }), moves, ({ question, seed }, pick, steps) => {
        let draft = initBoneOrderingDraft(question, null, seed);
        for (const [i, dir] of steps) draft = moveBone(draft, draft.order[i % draft.order.length] ?? '', dir);
        const boneId = question.keyOrder[pick % question.keyOrder.length] ?? '';
        const hint = { kind: 'lock-first-bone', boneId } as const;
        const hinted = applyBoneHint(draft, question, hint);
        expect(hinted.order.indexOf(boneId)).toBe(question.keyOrder.indexOf(boneId));
        expect([...hinted.order].sort()).toEqual([...question.itemIds].sort());
        expect(hinted.order.filter((id) => id !== boneId)).toEqual(draft.order.filter((id) => id !== boneId));
        expect(judge(question, answerOf(hinted), hint)).not.toBe('invalid');
        expect(applyBoneHint(hinted, question, hint)).toBe(hinted);
        // Moving afterwards still never breaks the hint.
        const after = steps.reduce((d, [i, dir]) => moveBone(d, d.order[i % d.order.length] ?? '', dir), hinted);
        expect(judge(question, answerOf(after), hint)).not.toBe('invalid');
      }),
    );
  });
  it('ignores a hint of another kind, or for an unknown bone', () => {
    const d = initBoneOrderingDraft({ itemIds: ['a', 'b', 'c'], keyOrder: ['a', 'b', 'c'] }, null, 's');
    const q = { itemIds: ['a', 'b', 'c'], keyOrder: ['a', 'b', 'c'] };
    expect(applyBoneHint(d, q, null)).toBe(d);
    expect(applyBoneHint(d, q, { kind: 'remove-option', optionId: 'a' })).toBe(d);
    expect(applyBoneHint(d, q, { kind: 'lock-first-bone', boneId: 'zzz' })).toBe(d);
  });
  it('Property 7: is total', () => {
    fc.assert(
      fc.property(boneOrderingArb, fc.string(), fc.constantFrom('up', 'down'), ({ question, hint, seed }, id, dir) => {
        const d = initBoneOrderingDraft(question, hint, seed);
        expect(() => boneOrderingSubmission(moveBone(d, id, dir))).not.toThrow();
      }),
    );
  });
});
