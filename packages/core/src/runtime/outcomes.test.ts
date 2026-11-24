import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { initial } from './initial';
import { deriveAllOutcomes, deriveConceptOutcome } from './outcomes';
import type { ConceptRecord } from './state-types';

const BASE: ConceptRecord = {
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
};

const rec = (change: Partial<ConceptRecord>): ConceptRecord => ({ ...BASE, ...change });

describe('deriveConceptOutcome', () => {
  it('first correct with no hint is first-try correct', () => {
    expect(deriveConceptOutcome(rec({ firstQuestionResult: 'correct' }))).toBe('first-try-correct');
  });

  it('first correct with a hint is assisted', () => {
    const r = rec({ firstQuestionResult: 'correct', hintUsedOnCorrectQuestion: true });
    expect(deriveConceptOutcome(r)).toBe('assisted');
  });

  it('hint on a challenged primary, Alternate correct with no hint, is first-try correct (22.11)', () => {
    const r = rec({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateResult: 'correct',
      hintUsedOnCorrectQuestion: false,
    });
    expect(deriveConceptOutcome(r)).toBe('first-try-correct');
  });

  it('hint on the Alternate then correct is assisted', () => {
    const r = rec({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateResult: 'correct',
      hintUsedOnCorrectQuestion: true,
    });
    expect(deriveConceptOutcome(r)).toBe('assisted');
  });

  it('a Return answered correctly is retried, even with a hint', () => {
    const r = rec({ firstQuestionResult: 'wrong', return1Result: 'correct', hintUsedOnCorrectQuestion: true });
    expect(deriveConceptOutcome(r)).toBe('retried');
  });

  it('a wrong Alternate followed by a correct Return is retried', () => {
    const r = rec({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateResult: 'wrong',
      return1Result: 'correct',
    });
    expect(deriveConceptOutcome(r)).toBe('retried');
  });

  it('a lingering spirit is review due', () => {
    const r = rec({
      firstQuestionResult: 'wrong',
      return1Result: 'wrong',
      return2Result: 'wrong',
      isLingeringSpirit: true,
      reviewDueFlag: true,
    });
    expect(deriveConceptOutcome(r)).toBe('review-due');
  });

  it('a skip with no Alternate is review due', () => {
    const r = rec({ wasSkippedWithNoAlternate: true, reviewDueFlag: true });
    expect(deriveConceptOutcome(r)).toBe('review-due');
  });

  it('a challenged Return after an earlier unchallenged miss is review due', () => {
    const r = rec({ firstQuestionResult: 'wrong', return1Result: 'challenged', reviewDueFlag: true });
    expect(deriveConceptOutcome(r)).toBe('review-due');
  });

  it('a challenged primary with no Alternate is challenged', () => {
    expect(deriveConceptOutcome(rec({ firstQuestionResult: 'challenged' }))).toBe('challenged');
  });

  it('a challenged primary and challenged Alternate is challenged', () => {
    const r = rec({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateChallenged: true,
      alternateResult: 'challenged',
    });
    expect(deriveConceptOutcome(r)).toBe('challenged');
  });

  it('a challenged primary with a wrong Alternate and no later result is review due', () => {
    const r = rec({
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      alternateResult: 'wrong',
      reviewDueFlag: true,
    });
    expect(deriveConceptOutcome(r)).toBe('review-due');
  });
});

describe('deriveAllOutcomes', () => {
  it('gives exactly one outcome for each concept in the manifest', () => {
    const state = initial(buildManifest(), SETTINGS);
    const outcomes = deriveAllOutcomes(state);
    expect(Object.keys(outcomes).sort()).toEqual(state.concepts.map((c) => c.conceptId).sort());
    expect(Object.keys(outcomes).length).toBe(state.concepts.length);
  });

  it('is JSON-safe', () => {
    const outcomes = deriveAllOutcomes(initial(buildManifest(), SETTINGS));
    expect(JSON.parse(JSON.stringify(outcomes))).toEqual(outcomes);
  });
});
