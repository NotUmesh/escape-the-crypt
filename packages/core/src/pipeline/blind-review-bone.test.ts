import { describe, expect, it } from 'vitest';
import { blindReview, decideReview, hasCompleteLabels } from './blind-review';
import { boneDisplayOrder, boneItemId } from './blind-review-prompt';
import {
  REVIEW_OPTIONS,
  cassetteFor,
  heart,
  loadReviewFixtures,
  requestFor,
  reviewLedger,
} from './blind-review-fixtures';

/** The item ids a reviewer would write to put the steps in `stepOrder` (indices into `steps`). */
function idsFor(steps: readonly string[], stepOrder: readonly number[]): string {
  const display = boneDisplayOrder(steps);
  return stepOrder.map((s) => boneItemId(display.indexOf(s))).join(',');
}

const fixtures = loadReviewFixtures(['bone-ordering']);
const byId = (id: string) => {
  const f = fixtures.find((x) => x.id === id);
  if (!f || f.question.lockType !== 'bone-ordering') throw new Error(`missing fixture ${id}`);
  return { ...f, steps: f.question.steps };
};

/**
 * SYNTHETIC replies, as in blind-review.test.ts: they test the wiring (request -> cassette ->
 * parse -> decideReview), not the real reviewer's ability to catch these.
 */
describe('blindReview: bone-ordering review:* fixtures via synthetic cassette', () => {
  it('loads the two bone-ordering review fixtures', () => {
    expect(fixtures.map((f) => f.id)).toEqual(['adv-15', 'adv-24']);
  });

  it('adv-15 (review:ambiguous-order): a reviewer that puts the flag after the rocks is rejected', async () => {
    const f = byId('adv-15');
    const reply = { answer: idsFor(f.steps, [0, 2, 1, 3]), optionLabels: null };
    const provider = await cassetteFor(f.question, f.doc, reply);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, f.question, f.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'answer-mismatch' } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });

  it('adv-24 (review:step-not-in-evidence): a reviewer that drops the unsupported first step is rejected', async () => {
    const f = byId('adv-24');
    const reply = { answer: idsFor(f.steps, [1, 2, 3, 4]), optionLabels: null };
    const provider = await cassetteFor(f.question, f.doc, reply);
    const verdict = await blindReview(provider, reviewLedger(), f.question, f.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'answer-mismatch' } });
    expect(provider.requests).toHaveLength(1);
  });

  it('adv-24 passes when the reviewer reproduces the exact order', async () => {
    const f = byId('adv-24');
    const reply = { answer: idsFor(f.steps, [0, 1, 2, 3, 4]), optionLabels: null };
    const provider = await cassetteFor(f.question, f.doc, reply);
    const verdict = await blindReview(provider, reviewLedger(), f.question, f.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'passed' });
  });
});

describe('bone-ordering review rule', () => {
  const q = () => byId('adv-24').question;
  const steps = byId('adv-24').steps;

  it('never shows the steps in key order, and shows each exactly once', () => {
    for (const f of fixtures) {
      if (f.question.lockType !== 'bone-ordering') continue;
      const order = boneDisplayOrder(f.question.steps);
      expect(order.every((v, i) => v === i)).toBe(false);
      expect([...order].sort()).toEqual(f.question.steps.map((_, i) => i));
    }
  });

  it('the request lists steps with ids but carries no key, explanation or quote', async () => {
    const f = byId('adv-24');
    const request = await requestFor(f.question, f.doc);
    const text = request.messages.map((m) => m.content).join('\n') + request.system;
    for (const step of f.steps) expect(text).toContain(step);
    expect(text).toContain('id s1:');
    expect(text).not.toContain('The sequence paragraph starts');
    // The listed order differs from the key order.
    const listed = [...text.matchAll(/- id s\d+: (.+)/g)].map((m) => m[1]);
    expect(listed).not.toEqual([...f.steps]);
  });

  it('rejects wrong order, repeated ids, a missing id and unknown ids', () => {
    const good = idsFor(steps, [0, 1, 2, 3, 4]);
    const mismatch = { verdict: 'rejected', reason: { kind: 'answer-mismatch' } };
    expect(decideReview(q(), { answer: good, optionLabels: null })).toEqual({ verdict: 'passed' });
    expect(decideReview(q(), { answer: ` ${good.split(',').join(' , ')} `, optionLabels: null })).toEqual({
      verdict: 'passed',
    });
    expect(decideReview(q(), { answer: idsFor(steps, [1, 0, 2, 3, 4]), optionLabels: null })).toEqual(mismatch);
    expect(decideReview(q(), { answer: idsFor(steps, [0, 0, 2, 3, 4]), optionLabels: null })).toEqual(mismatch);
    expect(decideReview(q(), { answer: idsFor(steps, [0, 1, 2, 3]), optionLabels: null })).toEqual(mismatch);
    expect(decideReview(q(), { answer: 's1,s2,s3,s4,zz', optionLabels: null })).toEqual(mismatch);
    expect(decideReview(q(), { answer: 'unknown', optionLabels: null })).toEqual({
      verdict: 'rejected',
      reason: { kind: 'unknown-label' },
    });
  });

  it('requires optionLabels to be null', () => {
    expect(hasCompleteLabels(q(), { answer: 's1', optionLabels: null })).toBe(true);
    expect(hasCompleteLabels(q(), { answer: 's1', optionLabels: [] })).toBe(false);
  });

  it('uses the same heart document the sample fixtures were built against', () => {
    expect(byId('adv-24').doc.chunks.size).toBe(heart.chunks.size);
  });
});
