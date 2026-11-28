import { describe, expect, it } from 'vitest';
import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { checkNegativeQuestion } from './evidence';
import { checkStepsListedInPrompt } from '../locks/bone-ordering-checks';
import { checkUnitsRevealNumber } from '../locks/combination-dial-checks';

// Checks added after the 2026-11-28 crypt-keeper review of the six-type dev run.

const dial = (units: string): CombinationDialAuthoringQuestion =>
  ({
    id: 'd',
    conceptId: 'c',
    role: 'primary',
    lockType: 'combination-dial',
    prompt: 'According to your notes, on what day did the crew land?',
    answer: { kind: 'exact', value: 20 },
    units,
    evidence: [{ paragraph: 1, quote: 'The crew landed on July 20, 1969.' }],
    explanation: '-',
  }) as unknown as CombinationDialAuthoringQuestion;

describe('units-reveal-number', () => {
  it('rejects units that carry the answer (dev-04 concept 5 alternate: answer 20, units "July 20")', () => {
    expect(checkUnitsRevealNumber(dial('July 20')).map((f) => f.checkId)).toEqual(['units-reveal-number']);
  });

  it('rejects any digit in the units, since units are shown beside the dial', () => {
    expect(checkUnitsRevealNumber(dial('per 100 people'))).toHaveLength(1);
  });

  it.each(['days', 'beats per minute', '%', '(no units)', 'm/s²', 'kilometres'])('accepts "%s"', (units) => {
    expect(checkUnitsRevealNumber(dial(units))).toEqual([]);
  });
});

describe('steps-listed-in-prompt', () => {
  const q = (prompt: string, steps: readonly string[]) => ({ id: 'b', prompt, steps: [...steps] });
  const steps = ['Egg', 'Larva', 'Pupa', 'Adult'];

  it('rejects a prompt that lists the steps in key order', () => {
    const failures = checkStepsListedInPrompt(
      q('According to your notes, order these stages: egg, larva, pupa and adult.', steps),
    );
    expect(failures.map((f) => f.checkId)).toEqual(['steps-listed-in-prompt']);
  });

  it('rejects two steps named in key order, which gives away part of the answer', () => {
    expect(checkStepsListedInPrompt(q('According to your notes, what comes between egg and adult?', steps))).toHaveLength(1);
  });

  it('accepts a prompt that names no step', () => {
    expect(checkStepsListedInPrompt(q('According to your notes, put the life cycle in order.', steps))).toEqual([]);
  });

  it('accepts a prompt that names one step', () => {
    expect(checkStepsListedInPrompt(q('According to your notes, what follows the egg? Order all four.', steps))).toEqual([]);
  });

  it('accepts steps named out of key order (no order is given away)', () => {
    expect(
      checkStepsListedInPrompt(q('According to your notes, order: adult, egg, pupa and larva.', steps)),
    ).toEqual([]);
  });
});

describe('negative-question exemption for cursed object', () => {
  it.each([
    'According to your notes, which item is not a type of vaccine?',
    'According to your notes, which one does not belong?',
    'According to your notes, which of these is not a layer of the atmosphere?',
  ])('exempts the odd-one-out wording "%s"', (prompt) => {
    expect(checkNegativeQuestion(prompt, 'q', 'cursed-object')).toBeNull();
  });

  it('still flags a negative prompt on other lock types', () => {
    expect(checkNegativeQuestion('According to your notes, which item is not a vaccine?', 'q', 'seance-board')?.checkId).toBe(
      'negative-question',
    );
  });

  it('still flags a cursed-object prompt that is negative without asking "which"', () => {
    expect(checkNegativeQuestion('According to your notes, find the item that is not listed.', 'q', 'cursed-object')?.checkId).toBe(
      'negative-question',
    );
  });
});
