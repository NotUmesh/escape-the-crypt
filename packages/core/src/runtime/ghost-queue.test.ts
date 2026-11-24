import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import {
  GHOST_DELAY,
  chooseReturnQuestion,
  hasEligibleReturnQuestion,
  isGhostDue,
  partitionGhosts,
  recordQuestionShown,
  spawnGhost,
} from './ghost-queue';
import type { ReturnQuestionChoice } from './ghost-queue';
import { GHOST_DELAY as reExported } from './index';
import type { LockSlotSpec } from './manifest-types';
import type { ConceptRecord, GhostState } from './state-types';

function record(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    conceptId: 'c1',
    shownQuestionIds: [],
    firstQuestionResult: null,
    hintUsedOnCorrectQuestion: false,
    alternateUsed: false,
    alternateChallenged: false,
    alternateResult: null,
    return1Result: null,
    return2Result: null,
    wasSkippedWithNoAlternate: false,
    isLingeringSpirit: false,
    reviewDueFlag: false,
    ...overrides,
  };
}

function specWith(alternates: boolean): LockSlotSpec {
  const slot = buildManifest({ rooms: 1, conceptsPerRoom: 2, alternates }).rooms[0]?.lockSlots[0];
  if (slot === undefined) throw new Error('fixture has no slot');
  return slot;
}

describe('GHOST_DELAY', () => {
  it('is 3 and re-exported from the runtime index', () => {
    expect(GHOST_DELAY).toBe(3);
    expect(reExported).toBe(3);
  });
});

describe('spawnGhost', () => {
  it('records the judged-answer count at spawn', () => {
    const result = spawnGhost([], 'c1', 1, 7);
    expect(result).toEqual({
      ok: true,
      ghosts: [{ conceptId: 'c1', returnNumber: 1, judgedAnswerCountAtSpawn: 7, due: false }],
    });
  });

  it('refuses a second pending ghost for the same concept', () => {
    const first = spawnGhost([], 'c1', 1, 0);
    if (!first.ok) throw new Error('expected ok');
    expect(spawnGhost(first.ghosts, 'c1', 2, 1)).toEqual({
      ok: false,
      error: { kind: 'ghost-already-pending', conceptId: 'c1' },
    });
    expect(spawnGhost(first.ghosts, 'c2', 1, 1).ok).toBe(true);
  });

  it('refuses a return number above 2 and does not mutate the input', () => {
    const ghosts: readonly GhostState[] = [];
    expect(spawnGhost(ghosts, 'c1', 3, 0)).toEqual({
      ok: false,
      error: { kind: 'return-cap-exceeded', conceptId: 'c1' },
    });
    expect(ghosts).toEqual([]);
  });
});

describe('due rule and carry-over', () => {
  const ghost: GhostState = { conceptId: 'c1', returnNumber: 1, judgedAnswerCountAtSpawn: 2, due: false };

  it('is due exactly when the count has advanced by GHOST_DELAY', () => {
    expect(isGhostDue(ghost, 2 + GHOST_DELAY - 1)).toBe(false);
    expect(isGhostDue(ghost, 2 + GHOST_DELAY)).toBe(true);
  });

  it('carries not-yet-due ghosts unchanged', () => {
    const { due, pending } = partitionGhosts([ghost], 3);
    expect(due).toEqual([]);
    expect(pending[0]).toBe(ghost);
  });

  it('marks due ghosts and keeps queue order', () => {
    const other: GhostState = { ...ghost, conceptId: 'c2', judgedAnswerCountAtSpawn: 4 };
    const { due, pending } = partitionGhosts([ghost, other], 5);
    expect(due).toEqual([{ ...ghost, due: true }]);
    expect(pending).toEqual([other]);
  });

  it('property: a ghost is due iff the count difference reaches the delay', () => {
    fc.assert(
      fc.property(fc.nat(100), fc.nat(100), (atSpawn, count) => {
        const g: GhostState = { conceptId: 'c', returnNumber: 1, judgedAnswerCountAtSpawn: atSpawn, due: false };
        const { due } = partitionGhosts([g], count);
        expect(due.length === 1).toBe(count - atSpawn >= GHOST_DELAY);
      }),
    );
  });
});

function mustChoose(...args: Parameters<typeof chooseReturnQuestion>): ReturnQuestionChoice {
  const result = chooseReturnQuestion(...args);
  if (!result.ok) throw new Error('expected an eligible question');
  return result.choice;
}

describe('chooseReturnQuestion', () => {
  it('return 1 uses the unused Alternate with no label', () => {
    const spec = specWith(true);
    const choice = mustChoose(spec, record({ shownQuestionIds: [spec.primaryQuestion.questionId] }), 1);
    expect(choice.question).toBe(spec.alternateQuestion);
    expect(choice.label).toBeNull();
    expect(choice.record.alternateUsed).toBe(true);
    expect(choice.record.shownQuestionIds).toContain(choice.question.questionId);
  });

  it('return 1 falls back to the primary, labelled Review, when the Alternate was used', () => {
    const spec = specWith(true);
    const shown = record({
      alternateUsed: true,
      shownQuestionIds: [spec.primaryQuestion.questionId, spec.alternateQuestion?.questionId ?? ''],
    });
    const choice = mustChoose(spec, shown, 1);
    expect(choice.question).toBe(spec.primaryQuestion);
    expect(choice.label).toBe('review');
    expect(choice.record.shownQuestionIds).toEqual(shown.shownQuestionIds);
  });

  it('return 1 uses the primary when there is no Alternate', () => {
    const spec = specWith(false);
    const choice = mustChoose(spec, record({ shownQuestionIds: [spec.primaryQuestion.questionId] }), 1);
    expect(choice.question).toBe(spec.primaryQuestion);
    expect(choice.label).toBe('review');
  });

  it('return 2 always uses the primary even when an Alternate is unused', () => {
    const spec = specWith(true);
    const choice = mustChoose(spec, record({ shownQuestionIds: [spec.primaryQuestion.questionId] }), 2);
    expect(choice.question).toBe(spec.primaryQuestion);
    expect(choice.label).toBe('review');
    expect(choice.record.alternateUsed).toBe(false);
  });
});

describe('return eligibility', () => {
  const none = { ok: false, error: { kind: 'no-eligible-question', conceptId: 'c1' } };

  it('never falls back to a challenged primary (return 1 and return 2)', () => {
    const spec = specWith(true);
    const challengedFirst = record({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateResult: 'wrong',
    });
    expect(chooseReturnQuestion(spec, challengedFirst, 1)).toEqual(none);
    expect(chooseReturnQuestion(spec, challengedFirst, 2)).toEqual(none);
    expect(hasEligibleReturnQuestion(spec, challengedFirst, 1)).toBe(false);
  });

  it('is eligible for a wrong primary, and ineligible without a spec', () => {
    const spec = specWith(true);
    expect(hasEligibleReturnQuestion(spec, record({ firstQuestionResult: 'wrong' }), 1)).toBe(true);
    expect(hasEligibleReturnQuestion(null, record(), 1)).toBe(false);
  });
});

describe('recordQuestionShown', () => {
  it('appends once and leaves the input unchanged', () => {
    const base = record();
    const once = recordQuestionShown(base, 'q1');
    expect(once.shownQuestionIds).toEqual(['q1']);
    expect(recordQuestionShown(once, 'q1')).toBe(once);
    expect(base.shownQuestionIds).toEqual([]);
  });
});
