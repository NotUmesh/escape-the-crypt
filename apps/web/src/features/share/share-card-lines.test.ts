import { describe, expect, it } from 'vitest';
import { buildShareCardData } from './share-card-data';
import { SHARE_URL } from './share-card-copy';
import { allCardText, cardLines, countsSentence, shareText } from './share-card-lines';
import { escapedView } from './share-test-support';

const COUNTS = { 'first-try-correct': 5, assisted: 2, retried: 1, challenged: 0, 'review-due': 3 } as const;
const sample = buildShareCardData(escapedView(COUNTS), { kind: 'sample', title: 'The human heart' });
const notes = buildShareCardData(escapedView(COUNTS), { kind: 'notes' });

describe('cardLines', () => {
  it('reads app name, headline, sample label, five counts, footer', () => {
    expect(sample && cardLines(sample).map((l) => l.role)).toEqual([
      'app',
      'headline',
      'note',
      'count',
      'count',
      'count',
      'count',
      'count',
      'footer',
    ]);
  });

  it('leaves out the sample label for a crypt made from notes', () => {
    expect(notes && cardLines(notes).map((l) => l.role)).not.toContain('note');
  });

  it('puts the number beside each count', () => {
    const counts = sample === null ? [] : cardLines(sample).filter((l) => l.role === 'count');
    expect(counts.map((l) => `${l.text}=${l.value}`)).toEqual([
      'First-try correct=5',
      'Assisted=2',
      'Retried=1',
      'Challenged: excluded from score=0',
      'Review due=3',
    ]);
  });
});

describe('shareText', () => {
  it('is the headline, the label, the counts, the footer and the public address', () => {
    expect(sample && shareText(sample)).toBe(
      [
        'Escaped \u201CThe human heart\u201D with 3 ghosts remaining',
        'Sample crypt',
        'First-try correct (5)',
        'Assisted (2)',
        'Retried (1)',
        'Challenged: excluded from score (0)',
        'Review due (3)',
        'Made with Escape the Crypt',
        SHARE_URL,
      ].join('\n'),
    );
    // The public address is the only link.
    expect(shareText(sample as NonNullable<typeof sample>).match(/https?:\/\/\S+|www\.\S+/g)).toEqual([
      SHARE_URL,
    ]);
  });

  it('names no title for a crypt made from notes', () => {
    expect(notes && shareText(notes).split('\n')[0]).toBe('Escaped a crypt made from my own notes with 3 ghosts remaining');
  });
});

describe('countsSentence and allCardText', () => {
  it('joins the counts for the text alternative', () => {
    expect(sample && countsSentence(sample)).toBe('First-try correct (5), Assisted (2), Retried (1), Challenged: excluded from score (0), Review due (3)');
  });

  it('lists every string the card can show', () => {
    const text = sample === null ? '' : allCardText(sample);
    expect(text).toContain('The human heart');
    expect(text).toContain('Review due');
  });
});
