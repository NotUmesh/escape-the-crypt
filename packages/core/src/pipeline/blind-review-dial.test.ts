import { describe, expect, it } from 'vitest';
import type { AuthoringQuestion, CombinationDialAuthoringQuestion } from '../authoring/schema';
import { blindReview, decideReview } from './blind-review';
import { computeTemplate } from '../locks/combination-dial-checks';
import { parseReviewerNumber } from './blind-review-dial';
import { buildBlindReviewUserMessage } from './blind-review-prompt';
import { REVIEW_OPTIONS, cassetteFor, loadReviewFixtures, reviewLedger } from './blind-review-fixtures';

const fixtures = loadReviewFixtures(['combination-dial']);
const byId = (id: string) => {
  const f = fixtures.find((x) => x.id === id);
  if (!f || f.question.lockType !== 'combination-dial') throw new Error(`missing fixture ${id}`);
  return f;
};
const adv21 = byId('adv-21');
const adv22 = byId('adv-22');

const mismatch = { verdict: 'rejected', reason: { kind: 'answer-mismatch' } };
const reply = (answer: string) => ({ answer, optionLabels: null });

function withAnswer(
  answer: CombinationDialAuthoringQuestion['answer'],
): AuthoringQuestion {
  return { ...(adv21.question as CombinationDialAuthoringQuestion), answer };
}

/**
 * SYNTHETIC replies, hand-written: they test the wiring (request -> cassette -> parse ->
 * decideReview), not the real reviewer's ability to catch these. The pipeline path also runs
 * Code_Checks, so these need the dial checks of task 35.2.
 */
describe('blindReview: combination-dial review:* fixtures via synthetic cassette', () => {
  it('loads the two dial review fixtures', () => {
    expect(fixtures.map((f) => [f.id, f.expectedCatch])).toEqual([
      ['adv-21', 'review:range-collapsed-to-exact'],
      ['adv-22', 'review:unit-mismatch'],
    ]);
  });

  it('adv-21 (range-collapsed-to-exact): a reviewer that gives 9 for "7 to 10 days" is rejected', async () => {
    const provider = await cassetteFor(adv21.question, adv21.doc, reply('9'));
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, adv21.question, adv21.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual(mismatch);
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });

  it('adv-21: a reviewer that answers with the whole span ("7 to 10") is rejected as unparseable', async () => {
    const provider = await cassetteFor(adv21.question, adv21.doc, reply('7 to 10'));
    const verdict = await blindReview(provider, reviewLedger(), adv21.question, adv21.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual(mismatch);
  });

  it('adv-22 (unit-mismatch): a reviewer that gives the other unit\'s number is rejected', async () => {
    const provider = await cassetteFor(adv22.question, adv22.doc, reply('2.5'));
    const verdict = await blindReview(provider, reviewLedger(), adv22.question, adv22.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual(mismatch);
  });

  it('adv-22: a reviewer that says unknown is rejected as unknown-label', async () => {
    const provider = await cassetteFor(adv22.question, adv22.doc, reply('unknown'));
    const verdict = await blindReview(provider, reviewLedger(), adv22.question, adv22.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'unknown-label' } });
  });

  it('passes when the reviewer derives the key number (units ignored)', async () => {
    const provider = await cassetteFor(adv22.question, adv22.doc, reply('21.5 hours'));
    const verdict = await blindReview(provider, reviewLedger(), adv22.question, adv22.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'passed' });
  });
});

describe('combination-dial review rule', () => {
  it('shows the prompt and cited chunks, never the key or the explanation', () => {
    const text = buildBlindReviewUserMessage(adv22.question, adv22.doc);
    expect(text).toContain('walking outside');
    expect(text).toContain('optionLabels to null');
    expect(text).not.toContain('"21.5"');
    expect(text).not.toContain('explanation');
  });

  it('normalises thousands separators and ignores unit words', () => {
    expect(parseReviewerNumber('150,000')).toBe('150000');
    expect(parseReviewerNumber('about 1,234.5 cups a day')).toBe('1234.5');
    expect(parseReviewerNumber('\u221220%')).toBe('-20');
    expect(parseReviewerNumber('12,34')).toBeNull();
    const q = withAnswer({ kind: 'exact', value: 150000 });
    expect(decideReview(q, reply('150,000 people'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('150000'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('15,000'))).toEqual(mismatch);
  });

  it('accepts any value inside a range key and rejects outside it', () => {
    const q = withAnswer({ kind: 'range', min: 7, max: 10 });
    expect(decideReview(q, reply('7'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('8.5'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('10 days'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('6'))).toEqual(mismatch);
    expect(decideReview(q, reply('11'))).toEqual(mismatch);
  });

  it('recomputes template keys in code and ignores the authored value', () => {
    expect(computeTemplate('percent-change', [100, 80])).toBe(-20);
    expect(computeTemplate('difference', [100, 80])).toBe(20);
    expect(computeTemplate('percent-change', [0, 5])).toBeNull();
    // Authored value -25 is wrong; the key is -20.
    const q = withAnswer({ kind: 'template', template: 'percent-change', inputs: [100, 80], value: -25 });
    expect(decideReview(q, reply('-20'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('-25'))).toEqual(mismatch);
    const zero = withAnswer({ kind: 'template', template: 'percent-change', inputs: [0, 5], value: 1 });
    expect(decideReview(zero, reply('1'))).toEqual(mismatch);
  });

  it('rejects unparseable replies and keeps unknown as unknown-label', () => {
    const q = withAnswer({ kind: 'exact', value: 7 });
    for (const bad of ['seven', '7 to 10', '', ' ', '7 and 8', '1e3']) {
      expect(decideReview(q, reply(bad))).toEqual(mismatch);
    }
    expect(decideReview(q, reply('unknown'))).toEqual({ verdict: 'rejected', reason: { kind: 'unknown-label' } });
  });
});
