import { describe, expect, it } from 'vitest';
import { blindReview, decideReview, hasCompleteLabels } from './blind-review';
import { threadsDisplayOrder, threadsLeftId, threadsRightId } from './blind-review-prompt';
import {
  REVIEW_OPTIONS,
  cassetteFor,
  loadReviewFixtures,
  requestFor,
  reviewLedger,
} from './blind-review-fixtures';

/** "L1=R3,..." for the given right-pair-index chosen by each left pair index. */
function replyFor(
  pairs: readonly { left: string; right: string }[],
  rightOfLeft: readonly number[],
): string {
  const order = threadsDisplayOrder(pairs);
  return order.left
    .map((pairIndex, position) => {
      const rightPos = order.right.indexOf(rightOfLeft[pairIndex] as number);
      return `${threadsLeftId(position)}=${threadsRightId(rightPos)}`;
    })
    .join(',');
}

const fixtures = loadReviewFixtures(['bound-threads']);
const adv19 = (() => {
  const f = fixtures.find((x) => x.id === 'adv-19');
  if (!f || f.question.lockType !== 'bound-threads') throw new Error('missing fixture adv-19');
  return { ...f, pairs: f.question.pairs };
})();
const key = adv19.pairs.map((_, i) => i);
const mismatch = { verdict: 'rejected', reason: { kind: 'answer-mismatch' } };

/** SYNTHETIC replies: they test the wiring (request -> cassette -> parse -> decideReview). */
describe('blindReview: bound-threads review:* fixtures via synthetic cassette', () => {
  it('loads the bound-threads review fixture', () => {
    expect(fixtures.map((f) => f.id)).toEqual(['adv-19']);
  });

  it('adv-19 (review:alternative-valid-pairing): a reviewer that swaps two rights is rejected', async () => {
    const reply = { answer: replyFor(adv19.pairs, [1, 0, 2]), optionLabels: null };
    const provider = await cassetteFor(adv19.question, adv19.doc, reply);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, adv19.question, adv19.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual(mismatch);
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });

  it('adv-19 passes when the reviewer reproduces the key pairs', async () => {
    const reply = { answer: replyFor(adv19.pairs, key), optionLabels: null };
    const provider = await cassetteFor(adv19.question, adv19.doc, reply);
    const verdict = await blindReview(provider, reviewLedger(), adv19.question, adv19.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'passed' });
  });
});

describe('bound-threads review rule', () => {
  const q = adv19.question;
  const good = replyFor(adv19.pairs, key);

  it('never lines the columns up as the key pairs them', () => {
    const order = threadsDisplayOrder(adv19.pairs);
    expect(order.left.every((v, i) => v === order.right[i])).toBe(false);
    expect([...order.left].sort()).toEqual(key);
    expect([...order.right].sort()).toEqual(key);
  });

  it('the request lists both columns with ids but carries no key pairing, explanation or quote', async () => {
    const request = await requestFor(q, adv19.doc);
    const text = request.messages.map((m) => m.content).join('\n') + request.system;
    for (const p of adv19.pairs) {
      expect(text).toContain(p.left);
      expect(text).toContain(p.right);
    }
    expect(text).toContain('id L1:');
    expect(text).toContain('id R1:');
    expect(text).not.toContain('two pairings are valid');
    const lefts = [...text.matchAll(/- id L\d+: (.+)/g)].map((m) => m[1]);
    const rights = [...text.matchAll(/- id R\d+: (.+)/g)].map((m) => m[1]);
    expect([lefts, rights]).not.toEqual([adv19.pairs.map((p) => p.left), adv19.pairs.map((p) => p.right)]);
  });

  it('accepts the key in any entry order, rejects partial, repeated, unknown and different pairings', () => {
    const reversed = good.split(',').reverse().join(' , ');
    expect(decideReview(q, { answer: good, optionLabels: null })).toEqual({ verdict: 'passed' });
    expect(decideReview(q, { answer: reversed, optionLabels: null })).toEqual({ verdict: 'passed' });
    for (const answer of [
      replyFor(adv19.pairs, [2, 1, 0]),
      replyFor(adv19.pairs, [1, 2, 0]),
      good.split(',').slice(0, 2).join(','),
      'L1=R1,L1=R2,L3=R3',
      'L1=R1,L2=R1,L3=R1',
      'L1=R1,L2=R2,L9=R3',
      'L1R1,L2R2,L3R3',
      '',
    ]) {
      expect(decideReview(q, { answer, optionLabels: null })).toEqual(mismatch);
    }
    expect(decideReview(q, { answer: 'unknown', optionLabels: null })).toEqual({
      verdict: 'rejected',
      reason: { kind: 'unknown-label' },
    });
  });

  it('requires optionLabels to be null', () => {
    expect(hasCompleteLabels(q, { answer: good, optionLabels: null })).toBe(true);
    expect(hasCompleteLabels(q, { answer: good, optionLabels: [] })).toBe(false);
  });
});
