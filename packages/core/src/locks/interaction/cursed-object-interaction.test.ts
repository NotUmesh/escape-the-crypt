import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cursedObjectArb } from '../../test-support/lock-interaction-arbitraries';
import { judge } from '../cursed-object';
import { chooseItem, clearChoice, cursedObjectSubmission, initCursedObjectDraft } from './cursed-object-interaction';
import * as moduleExports from './cursed-object-interaction';

describe('cursed object interaction', () => {
  it('Property 1: choosing the odd item is correct, any other enabled item is wrong', () => {
    fc.assert(
      fc.property(cursedObjectArb, ({ question, hint, seed }) => {
        const draft = initCursedObjectDraft(question, hint, seed);
        for (const id of question.optionIds) {
          const chosen = chooseItem(draft, id);
          const result = cursedObjectSubmission(chosen);
          if (draft.removedId === id) {
            expect(result.ready).toBe(false);
            continue;
          }
          expect(result.ready).toBe(true);
          if (!result.ready) continue;
          expect(judge(question, result.submission, hint)).toBe(id === question.oddOneOutId ? 'correct' : 'wrong');
        }
      }),
    );
  });
  it('Property 6: never submits the removed item', () => {
    fc.assert(
      fc.property(cursedObjectArb, fc.array(fc.string(), { maxLength: 6 }), ({ question, hint, seed }, noise) => {
        let d = initCursedObjectDraft(question, hint, seed);
        for (const id of [...noise, ...question.optionIds]) d = chooseItem(d, id);
        const s = cursedObjectSubmission(d);
        if (s.ready && d.removedId !== null) expect(s.submission.selectedId).not.toBe(d.removedId);
      }),
    );
  });
  it('shows every option once, in a seeded order', () => {
    fc.assert(
      fc.property(cursedObjectArb, ({ question, hint, seed }) => {
        const d = initCursedObjectDraft(question, hint, seed);
        expect([...d.itemIds].sort()).toEqual([...question.optionIds].sort());
      }),
    );
  });
  it('is not ready until something is chosen, and clearing goes back to not ready', () => {
    const d = initCursedObjectDraft({ optionIds: ['a', 'b', 'c'] }, null, 's');
    expect(cursedObjectSubmission(d).ready).toBe(false);
    expect(cursedObjectSubmission(clearChoice(chooseItem(d, 'a'))).ready).toBe(false);
    expect(chooseItem(d, 'zzz')).toBe(d);
  });
  it('exports nothing that returns the key', () => {
    expect(Object.keys(moduleExports).sort()).toEqual(['chooseItem', 'clearChoice', 'cursedObjectSubmission', 'initCursedObjectDraft']);
  });
});
