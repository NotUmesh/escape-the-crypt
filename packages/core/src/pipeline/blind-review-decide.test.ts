import { describe, expect, it } from 'vitest';
import { decideReview, hasCompleteLabels } from './blind-review';
import type { ReviewResponse } from './blind-review-prompt';
import { labels, runeQuestion, seanceQuestion } from './blind-review-fixtures';

const rejected = (kind: string) => ({ verdict: 'rejected', reason: { kind } });
const resp = (r: unknown) => r as ReviewResponse;

describe('decideReview: rune cipher', () => {
  const q = runeQuestion();
  const say = (answer: string) => resp({ answer, optionLabels: null });

  it('passes the key, with the judge normalising case and spaces', () => {
    expect(decideReview(q, say('Atrioventricular '))).toEqual({ verdict: 'passed' });
  });
  it('passes an alias', () => {
    expect(decideReview(q, say('av-alias-sentinel'))).toEqual({ verdict: 'passed' });
  });
  it('rejects a different answer as answer-mismatch', () => {
    expect(decideReview(q, say('semilunar'))).toEqual(rejected('answer-mismatch'));
  });
  it('rejects "unknown" in any case as unknown-label', () => {
    expect(decideReview(q, say('  UNKNOWN '))).toEqual(rejected('unknown-label'));
  });
  it('respects caseSensitive', () => {
    const strict = runeQuestion({ caseSensitive: true });
    expect(decideReview(strict, say('ATRIOVENTRICULAR'))).toEqual(rejected('answer-mismatch'));
    expect(decideReview(strict, say('atrioventricular'))).toEqual({ verdict: 'passed' });
  });
});

describe('decideReview: séance board', () => {
  const q = seanceQuestion();

  it('passes the key with supported/contradicted labels', () => {
    expect(decideReview(q, resp(labels('contradicted', 'supported', 'contradicted')))).toEqual({
      verdict: 'passed',
    });
  });
  it('rejects a different option as answer-mismatch', () => {
    expect(decideReview(q, resp({ ...labels('supported', 'contradicted', 'contradicted'), answer: 'a' }))).toEqual(
      rejected('answer-mismatch'),
    );
  });
  it('rejects the key labelled contradicted as label-mismatch', () => {
    expect(decideReview(q, resp(labels('contradicted', 'contradicted', 'contradicted')))).toEqual(
      rejected('label-mismatch'),
    );
  });
  it('rejects another option labelled supported as label-mismatch', () => {
    expect(decideReview(q, resp(labels('contradicted', 'supported', 'supported')))).toEqual(
      rejected('label-mismatch'),
    );
  });
  it('rejects any unknown label, even when the answer matches', () => {
    expect(decideReview(q, resp(labels('contradicted', 'supported', 'unknown')))).toEqual(
      rejected('unknown-label'),
    );
  });
  it('checks unknown before answer-mismatch', () => {
    expect(decideReview(q, resp({ ...labels('unknown', 'supported', 'contradicted'), answer: 'c' }))).toEqual(
      rejected('unknown-label'),
    );
  });
  it('rejects the answer "unknown" as unknown-label', () => {
    expect(decideReview(q, resp({ ...labels('contradicted', 'contradicted', 'contradicted'), answer: 'unknown' }))).toEqual(
      rejected('unknown-label'),
    );
  });
});

describe('hasCompleteLabels', () => {
  const s = seanceQuestion();
  const r = runeQuestion();

  it('accepts exactly one label per shown option, in any order', () => {
    const reply = resp({
      answer: 'b',
      optionLabels: [
        { optionId: 'c', label: 'contradicted' },
        { optionId: 'a', label: 'contradicted' },
        { optionId: 'b', label: 'supported' },
      ],
    });
    expect(hasCompleteLabels(s, reply)).toBe(true);
  });
  it('rejects a missing, unknown or duplicated id and null labels for séance', () => {
    const only = (ids: string[]) =>
      resp({ answer: 'b', optionLabels: ids.map((optionId) => ({ optionId, label: 'supported' })) });
    expect(hasCompleteLabels(s, only(['a', 'b']))).toBe(false);
    expect(hasCompleteLabels(s, only(['a', 'b', 'z']))).toBe(false);
    expect(hasCompleteLabels(s, only(['a', 'a', 'b']))).toBe(false);
    expect(hasCompleteLabels(s, resp({ answer: 'b', optionLabels: null }))).toBe(false);
  });
  it('requires null labels for rune cipher', () => {
    expect(hasCompleteLabels(r, resp({ answer: 'x', optionLabels: null }))).toBe(true);
    expect(hasCompleteLabels(r, resp({ answer: 'x', optionLabels: [] }))).toBe(false);
  });
});
