import { initial, selectAutopsy } from '@escape-the-crypt/core';
import type { ConceptOutcome, ConceptRecord, State } from '@escape-the-crypt/core';
import { describe, expect, it } from 'vitest';
import { SAMPLE_CRYPT, SAMPLE_NOTES_TEXT } from '../../test-support/sample-bundle';
import { useMount } from '../../test-support/flow-dom';
import { ShareCard } from './share-card';
import { SHARE_COPY } from '@escape-the-crypt/core';
import { buildShareCardData } from './share-card-data';
import type { ShareCardData, ShareCrypt } from './share-card-data';
import { layoutCard } from './share-card-image';
import type { CardPalette } from './share-card-image';
import { allCardText, cardLines, shareText } from './share-card-lines';
import { escapedView } from './share-test-support';

const TITLE = 'The human heart';
const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 2 } as const;
const PALETTE: CardPalette = { paper: 'P', ink: 'I', titleFont: 'T', bodyFont: 'B' };

const BASE: Omit<ConceptRecord, 'conceptId'> = {
  shownQuestionIds: [],
  firstQuestionResult: 'correct',
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
const PATCH: Readonly<Record<ConceptOutcome, Partial<ConceptRecord>>> = {
  'first-try-correct': {},
  assisted: { hintUsedOnCorrectQuestion: true },
  retried: { firstQuestionResult: 'wrong', return1Result: 'correct' },
  challenged: { firstQuestionResult: 'challenged' },
  'review-due': { reviewDueFlag: true },
};
const ORDER: readonly ConceptOutcome[] = ['first-try-correct', 'assisted', 'retried', 'challenged', 'review-due'];

/** A real escaped State of the sample crypt, with every outcome in use. */
function escapedState(): State {
  const start = initial(SAMPLE_CRYPT.manifest, SETTINGS);
  const concepts = start.concepts.map((c, i) => ({ ...BASE, ...PATCH[ORDER[i % ORDER.length] ?? 'assisted'], conceptId: c.conceptId }));
  return { ...start, status: 'escaped', concepts };
}

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (value instanceof Map) for (const v of value.values()) stringLeaves(v, out);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
}

/** Everything in the sample crypt that a learner studies: questions, options, excerpts, concept titles, chunks, notes. */
function studyStrings(): string[] {
  const all = [
    ...stringLeaves(SAMPLE_CRYPT.content),
    ...stringLeaves(SAMPLE_CRYPT.chunks),
    ...SAMPLE_NOTES_TEXT.split(/\n+/),
  ].map((s) => s.trim());
  return [...new Set(all)].filter((s) => s.length >= 12 && s !== TITLE);
}

function windows(text: string, size: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const out: string[] = [];
  for (let i = 0; i + size <= words.length; i += 1) out.push(words.slice(i, i + size).join(' '));
  return out;
}

describe('the share card holds no study content', () => {
  const mount = useMount();
  const state = escapedState();
  const view = selectAutopsy(state);
  const study = studyStrings();

  /** Every place the card can put text: the page, the shared text, the PNG layout, the image alt. */
  function corpus(data: ShareCardData): string[] {
    mount.render(<ShareCard data={data} />);
    const html = mount.container.innerHTML;
    const lines = cardLines(data);
    const layout = layoutCard(lines, PALETTE, () => (t) => t.length * 10);
    return [
      html,
      mount.container.textContent ?? '',
      shareText(data),
      allCardText(data),
      layout.items.map((i) => i.text).join('\n'),
      SHARE_COPY.imageAlt(shareText(data), allCardText(data)),
    ];
  }

  function leaks(data: ShareCardData): string[] {
    const found: string[] = [];
    const texts = corpus(data);
    for (const text of texts) {
      for (const s of study) if (text.includes(s)) found.push(s);
      for (const id of state.concepts.map((c) => c.conceptId)) if (text.includes(id)) found.push(id);
    }
    // Any five words in a row from the study text.
    const phrases = new Set(study.flatMap((s) => windows(s, 5)));
    for (const text of texts) for (const phrase of windows(text.replace(/<[^>]+>/g, ' '), 5)) if (phrases.has(phrase)) found.push(phrase);
    return found;
  }

  it('has study text to check against', () => {
    expect(view.available).toBe(true);
    expect(study.length).toBeGreaterThan(50);
  });

  for (const crypt of [{ kind: 'sample', title: TITLE }, { kind: 'notes' }] as const satisfies readonly ShareCrypt[]) {
    it(`carries none of it, for a ${crypt.kind} crypt`, () => {
      const data = buildShareCardData(view, crypt);
      expect(data).not.toBeNull();
      expect(leaks(data as ShareCardData)).toEqual([]);
    });
  }

  it('shows the real counts of the escaped run and nothing about which concepts they came from', () => {
    const data = buildShareCardData(view, { kind: 'notes' }) as ShareCardData;
    expect(data.counts.reduce((sum, c) => sum + c.count, 0)).toBe(state.concepts.length);
    for (const concept of Object.values(SAMPLE_CRYPT.content.concepts)) {
      expect(JSON.stringify(data)).not.toContain(concept.title);
    }
  });

  it('ignores extra fields on the data it is given, so a question or an answer cannot be drawn', () => {
    const data = buildShareCardData(escapedView({ 'review-due': 1 }), { kind: 'notes' }) as ShareCardData;
    const dirty = {
      ...data,
      question: 'WHICH-CHAMBER-QUESTION',
      answer: 'RIGHT-VENTRICLE-ANSWER',
      notes: 'MY-PRIVATE-NOTE-TEXT',
      title: null,
    } as unknown as ShareCardData;
    mount.render(<ShareCard data={dirty} />);
    const html = mount.container.innerHTML;
    for (const secret of ['WHICH-CHAMBER-QUESTION', 'RIGHT-VENTRICLE-ANSWER', 'MY-PRIVATE-NOTE-TEXT']) {
      expect(html).not.toContain(secret);
    }
    const texts = [shareText(dirty), allCardText(dirty)];
    for (const secret of ['WHICH-CHAMBER-QUESTION', 'RIGHT-VENTRICLE-ANSWER', 'MY-PRIVATE-NOTE-TEXT']) {
      for (const text of texts) expect(text).not.toContain(secret);
    }
  });

  it('builds its data from the five counts alone: the keys are fixed', () => {
    const data = buildShareCardData(view, { kind: 'sample', title: TITLE }) as ShareCardData;
    expect(Object.keys(data).sort()).toEqual(['counts', 'ghostsRemaining', 'sample', 'title']);
    for (const count of data.counts) expect(Object.keys(count).sort()).toEqual(['count', 'label', 'outcome']);
  });
});
