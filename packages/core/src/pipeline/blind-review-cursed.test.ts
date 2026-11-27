import { describe, expect, it } from 'vitest';
import { blindReview, decideReview, hasCompleteLabels } from './blind-review';
import { cursedDisplayOrder, cursedItemId } from './blind-review-prompt';
import {
  REVIEW_OPTIONS,
  cassetteFor,
  loadReviewFixtures,
  requestFor,
  reviewLedger,
} from './blind-review-fixtures';

const fixtures = loadReviewFixtures(['cursed-object']);
const adv20 = (() => {
  const f = fixtures.find((x) => x.id === 'adv-20');
  if (!f || f.question.lockType !== 'cursed-object') throw new Error('missing fixture adv-20');
  return { ...f, items: f.question.items, answer: f.question.answer };
})();

/** Display id of an item, by its text. */
const idOf = (text: string): string =>
  cursedItemId(cursedDisplayOrder(adv20.items).indexOf(adv20.items.indexOf(text)));

/** A reply naming `named`, with the stated rule as per-item labels (odd item contradicted). */
type Label = 'unknown' | 'supported' | 'contradicted';

function reply(named: string, odd: string, overrides: Record<string, Label> = {}) {
  return {
    answer: idOf(named),
    optionLabels: adv20.items.map((t) => ({
      optionId: idOf(t),
      label: overrides[t] ?? (t === odd ? ('contradicted' as const) : ('supported' as const)),
    })),
  };
}

/**
 * SYNTHETIC replies, hand-written: they test the wiring (request -> cassette -> parse ->
 * decideReview), not the real reviewer's ability to catch these.
 */
describe('blindReview: cursed-object review:* fixtures via synthetic cassette', () => {
  it('loads the one cursed-object review fixture', () => {
    expect(fixtures.map((f) => f.id)).toEqual(['adv-20']);
  });

  it('adv-20 (review:odd-item-not-explicitly-outside): a reviewer that labels the odd item unknown is rejected', async () => {
    const r = reply('Moths', 'Moths', { Moths: 'unknown' });
    const provider = await cassetteFor(adv20.question, adv20.doc, r);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, adv20.question, adv20.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'unknown-label' } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });

  it('adv-20: a reviewer that names a different item is rejected', async () => {
    const r = reply('Bees', 'Bees');
    const provider = await cassetteFor(adv20.question, adv20.doc, r);
    const verdict = await blindReview(provider, reviewLedger(), adv20.question, adv20.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'answer-mismatch' } });
  });

  it('passes when the reviewer names the key item and states the rule for all four items', async () => {
    const r = reply('Moths', 'Moths');
    const provider = await cassetteFor(adv20.question, adv20.doc, r);
    const verdict = await blindReview(provider, reviewLedger(), adv20.question, adv20.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'passed' });
  });
});

describe('cursed-object review rule', () => {
  const q = adv20.question;
  const mismatch = { verdict: 'rejected', reason: { kind: 'answer-mismatch' } };

  it('shows each item once, in a text-derived order, with no key, rule label or explanation', async () => {
    const order = cursedDisplayOrder(adv20.items);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(cursedDisplayOrder([...adv20.items].reverse()).map((i) => [...adv20.items].reverse()[i])).toEqual(
      order.map((i) => adv20.items[i]),
    );
    const request = await requestFor(q, adv20.doc);
    const text = request.messages.map((m) => m.content).join('\n') + request.system;
    for (const item of adv20.items) expect(text).toContain(item);
    expect(text).toContain('id c1:');
    expect(text).not.toContain('The notes never mention moths');
    expect(text).not.toContain('Butterflies, beetles, flies and bees go through');
  });

  it('rejects other items, a missing or partial rule, wrong rule labels and unknown', () => {
    expect(decideReview(q, reply('Moths', 'Moths'))).toEqual({ verdict: 'passed' });
    expect(decideReview(q, reply('Beetles', 'Beetles'))).toEqual(mismatch);
    expect(decideReview(q, { answer: idOf('Moths'), optionLabels: null })).toEqual(mismatch);
    expect(
      decideReview(q, { answer: idOf('Moths'), optionLabels: reply('Moths', 'Moths').optionLabels.slice(1) }),
    ).toEqual(mismatch);
    expect(decideReview(q, reply('Moths', 'Moths', { Moths: 'supported' }))).toEqual(mismatch);
    expect(decideReview(q, reply('Moths', 'Moths', { Bees: 'contradicted' }))).toEqual(mismatch);
    expect(decideReview(q, { answer: 'Moths', optionLabels: reply('Moths', 'Moths').optionLabels })).toEqual(
      mismatch,
    );
    expect(decideReview(q, { answer: 'unknown', optionLabels: null })).toEqual({
      verdict: 'rejected',
      reason: { kind: 'unknown-label' },
    });
  });

  it('requires exactly one label per shown item id', () => {
    expect(hasCompleteLabels(q, reply('Moths', 'Moths'))).toBe(true);
    expect(hasCompleteLabels(q, { answer: 'c1', optionLabels: null })).toBe(false);
    expect(hasCompleteLabels(q, { answer: 'c1', optionLabels: [{ optionId: 'zz', label: 'supported' }] })).toBe(
      false,
    );
  });
});
