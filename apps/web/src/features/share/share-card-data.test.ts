import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildShareCardData, cleanTitle } from './share-card-data';
import type { ShareCrypt } from './share-card-data';
import { NOT_ESCAPED, escapedView } from './share-test-support';

const SAMPLE: ShareCrypt = { kind: 'sample', title: 'The human heart' };

describe('buildShareCardData', () => {
  it('is null until the run has escaped', () => {
    expect(buildShareCardData(NOT_ESCAPED, SAMPLE)).toBeNull();
  });

  it('lists the five outcomes in the Autopsy order with the Autopsy labels', () => {
    const data = buildShareCardData(
      escapedView({ 'first-try-correct': 5, assisted: 2, retried: 1, challenged: 0, 'review-due': 3 }),
      SAMPLE,
    );
    expect(data?.counts.map((c) => [c.label, c.count])).toEqual([
      ['First-try correct', 5],
      ['Assisted', 2],
      ['Retried', 1],
      ['Challenged: excluded from score', 0],
      ['Review due', 3],
    ]);
  });

  it('counts the ghosts that remain as the concepts still due for review', () => {
    expect(buildShareCardData(escapedView({ 'review-due': 4 }), SAMPLE)?.ghostsRemaining).toBe(4);
    expect(buildShareCardData(escapedView({ assisted: 4 }), SAMPLE)?.ghostsRemaining).toBe(0);
  });

  it('gives a sample its public title and marks it a sample', () => {
    const data = buildShareCardData(escapedView(), SAMPLE);
    expect(data?.title).toBe('The human heart');
    expect(data?.sample).toBe(true);
  });

  it('gives a crypt made from notes no title, even if one is smuggled in', () => {
    const smuggled = { kind: 'notes', title: 'My private lecture on X' } as unknown as ShareCrypt;
    const data = buildShareCardData(escapedView(), smuggled);
    expect(data?.title).toBeNull();
    expect(data?.sample).toBe(false);
    expect(JSON.stringify(data)).not.toContain('private lecture');
  });

  it('never carries the entries, concept IDs or labels of the view', () => {
    const data = buildShareCardData(escapedView({ 'review-due': 1 }, 'SECRET-CONCEPT-ID'), SAMPLE);
    expect(JSON.stringify(data)).not.toContain('SECRET-CONCEPT-ID');
    expect(Object.keys(data ?? {}).sort()).toEqual(['counts', 'ghostsRemaining', 'sample', 'title']);
  });

  it('reads a count that is not a whole number of 0 or more as 0', () => {
    const bad = escapedView({
      assisted: -3,
      retried: 1.5,
      challenged: Number.NaN,
      'review-due': '7' as unknown as number,
    });
    expect(buildShareCardData(bad, SAMPLE)?.counts.map((c) => c.count)).toEqual([0, 0, 0, 0, 0]);
  });

  it('property: every count is a whole number of 0 or more, and ghosts equal the review-due count', () => {
    const count = fc.integer({ min: 0, max: 500 });
    fc.assert(
      fc.property(count, count, count, count, count, (a, b, c, d, e) => {
        const data = buildShareCardData(
          escapedView({ 'first-try-correct': a, assisted: b, retried: c, challenged: d, 'review-due': e }),
          SAMPLE,
        );
        expect(data?.counts.map((x) => x.count)).toEqual([a, b, c, d, e]);
        expect(data?.ghostsRemaining).toBe(e);
      }),
    );
  });
});

describe('cleanTitle', () => {
  it('keeps one plain line', () => {
    expect(cleanTitle('  The   human\nheart\t ')).toBe('The human heart');
  });

  it('removes control and line-separator characters', () => {
    expect(cleanTitle('A\u0000B\u2028C\u007fD')).toBe('A B C D');
  });

  it('caps the length with an ellipsis', () => {
    const long = cleanTitle('word '.repeat(40)) ?? '';
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('\u2026')).toBe(true);
  });

  it('gives null for an empty title', () => {
    expect(cleanTitle('   \n ')).toBeNull();
    expect(buildShareCardData(escapedView(), { kind: 'sample', title: '' })?.title).toBeNull();
  });
});
