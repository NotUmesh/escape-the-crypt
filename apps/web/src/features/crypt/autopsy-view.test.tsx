import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOPSY_LABELS,
  BANNED_COPY_PHRASES,
  buildHumanHeartSampleCrypt,
  citationLabel,
  ROOM_PLAY_LABELS,
} from '@escape-the-crypt/core';
import type {
  ConceptOutcome,
  ConceptRecord,
  HumanHeartQuestionsFile,
  SampleCryptResult,
  State,
} from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { AutopsyView } from './autopsy-view';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');

function build(): SampleCryptResult {
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}

const CRYPT = build();
const OUTCOMES: readonly ConceptOutcome[] = ['first-try-correct', 'assisted', 'retried', 'challenged', 'review-due'];

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

const RECORDS: Readonly<Record<ConceptOutcome, Partial<ConceptRecord>>> = {
  'first-try-correct': {},
  assisted: { hintUsedOnCorrectQuestion: true },
  retried: { firstQuestionResult: 'wrong', return1Result: 'correct' },
  challenged: { firstQuestionResult: 'challenged' },
  'review-due': { reviewDueFlag: true },
};

let binding: RoomBinding;
let outcomes: readonly ConceptOutcome[] = [];
let dispatch = vi.fn();

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  const concepts = binding.state.concepts.map((c, i) => ({
    ...BASE,
    ...RECORDS[outcomes[i % outcomes.length] ?? 'first-try-correct'],
    conceptId: c.conceptId,
  }));
  const state: State = { ...binding.state, status: 'escaped', concepts };
  return createElement(AutopsyView, { state, assets: binding.assets, dispatch });
}

afterEach(() => {
  outcomes = [];
  dispatch = vi.fn();
});

describe('AutopsyView', () => {
  const mount = useMount();

  function show(list: readonly ConceptOutcome[]): void {
    outcomes = list;
    mount.render(createElement(Harness));
    act(() => binding.dispatch({ type: 'startRun' }));
  }

  it('shows one entry per concept with its title and label', () => {
    show(['first-try-correct', 'retried']);
    const entries = Array.from(mount.container.querySelectorAll('.autopsy-entry'));
    expect(entries).toHaveLength(binding.state?.concepts.length ?? -1);
    entries.forEach((entry, i) => {
      const conceptId = binding.state?.concepts[i]?.conceptId ?? '';
      expect(entry.querySelector('h4')?.textContent).toBe(CRYPT.content.concepts[conceptId]?.title);
      const outcome = outcomes[i % outcomes.length] as ConceptOutcome;
      expect(entry.textContent).toContain(AUTOPSY_LABELS[outcome]);
    });
  });

  it('puts the share card after the counts, with the sample title and no concept text', () => {
    show(['first-try-correct', 'review-due']);
    const section = mount.container.querySelector('[data-testid="share-section"]');
    expect(section).not.toBeNull();
    const counts = mount.container.querySelector('.autopsy-counts');
    expect(counts?.compareDocumentPosition(section as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(section?.querySelector('[data-testid="share-headline"]')?.textContent).toContain('Sample crypt');
    for (const concept of Object.values(CRYPT.content.concepts)) expect(section?.textContent).not.toContain(concept.title);
  });
  it('shows the five counts', () => {
    show(['first-try-correct', 'review-due']);
    const total = OUTCOMES.reduce(
      (sum, o) => sum + Number(mount.container.querySelector(`[data-testid="autopsy-count-${o}"]`)?.textContent),
      0,
    );
    expect(total).toBe(binding.state?.concepts.length);
    expect(mount.container.querySelector('[data-testid="autopsy-count-review-due"]')?.textContent).toBe('1');
    expect(mount.container.querySelector('[data-testid="autopsy-count-retried"]')?.textContent).toBe('0');
  });

  it('draws an aria-hidden icon beside every outcome label', () => {
    show(['first-try-correct', 'review-due']);
    const marks = mount.container.querySelectorAll('.autopsy-outcome');
    expect(marks.length).toBeGreaterThanOrEqual(5);
    marks.forEach((mark) => {
      const svg = mark.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(mark.querySelector('.autopsy-outcome__label')?.textContent).not.toBe('');
    });
  });

  it('shows the first excerpt of the concept first question with a sample label', () => {
    show(['first-try-correct']);
    const conceptId = binding.state?.concepts[0]?.conceptId ?? '';
    const questionId = binding.assets?.firstQuestionByConcept[conceptId] ?? '';
    const excerpt = CRYPT.content.questions[questionId]?.excerpts[0];
    expect(excerpt).toBeDefined();
    const entry = mount.container.querySelector('.autopsy-entry');
    expect(entry?.querySelector('blockquote')).toBeNull();
    act(() => buttonByText(entry as Element, ROOM_PLAY_LABELS.showExcerpt).click());
    expect(entry?.querySelector('blockquote')?.textContent).toBe(excerpt?.quote);
    const chunk = CRYPT.chunks.get(excerpt?.chunkId ?? '');
    const caption = entry?.querySelector('figcaption')?.textContent ?? '';
    expect(caption).toContain(chunk === undefined ? '?' : citationLabel(chunk, 'sample'));
    expect(caption).toMatch(/of the sample notes/);
  });

  it('states that a challenged concept is excluded from the score', () => {
    show(['challenged', 'first-try-correct']);
    const entries = mount.container.querySelectorAll('.autopsy-entry');
    expect(entries[0]?.textContent).toContain('excluded from the score');
    expect(entries[1]?.textContent).not.toContain('excluded from the score');
  });

  it('dispatches playAgain from Play again', () => {
    show(['first-try-correct']);
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.playAgain).click());
    expect(dispatch).toHaveBeenCalledWith({ type: 'playAgain' });
  });

  it('uses no banned phrases', () => {
    show(['first-try-correct', 'challenged']);
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.showExcerpt).click());
    const text = (mount.container.textContent ?? '').toLowerCase();
    for (const phrase of BANNED_COPY_PHRASES) expect(text).not.toContain(phrase.toLowerCase());
  });
});
