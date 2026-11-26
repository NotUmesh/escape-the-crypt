import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BANNED_COPY_PHRASES, ROOM_ANNOUNCEMENT_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { Chunk, CryptContent, Event, FinalDoorSlotState, LockSlotState, ReturnSlotState, SlotStatus } from '@escape-the-crypt/core';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { EvidencePanel } from './evidence-panel';
import type { EvidencePanelProps } from './evidence-panel';

const chunk = (id: string, text: string, paragraph: number): Chunk =>
  ({
    id,
    documentDigest: 'd',
    position: paragraph,
    text,
    location: { sourceType: 'paste', paragraphNumber: paragraph },
    edited: false,
  }) as unknown as Chunk;

const CHUNKS = new Map<string, Chunk>([
  ['c1', chunk('c1', 'The aorta carries blood from the heart.', 1)],
  ['c2', chunk('c2', 'The vena cava returns blood to the heart.', 2)],
  ['c3', chunk('c3', 'Valves stop blood flowing backwards.', 3)],
]);

const CONTENT: CryptContent = {
  questions: {
    q1: {
      prompt: 'According to your notes, what carries blood from the heart?',
      options: { a: 'The aorta', b: 'The vena cava', c: 'The valve' },
      excerpts: [
        { chunkId: 'c3', quote: 'Valves stop blood flowing backwards.' },
        { chunkId: 'c1', quote: 'The aorta carries blood from the heart.', optionId: 'a' },
        { chunkId: 'c2', quote: 'This quote is not in the chunk', optionId: 'b' },
      ],
      explanation: 'The aorta leaves the heart.',
    },
    q2: {
      prompt: 'According to your notes, name the vessel.',
      excerpts: [{ chunkId: 'c1', quote: 'The aorta carries blood from the heart.' }],
      explanation: '',
    },
  },
  concepts: {},
};

const lockSlot = (judgedResult: LockSlotState['judgedResult'], status: SlotStatus, q = 'q1'): LockSlotState => ({
  slotId: 's1',
  stationType: 'seance-board',
  currentQuestionId: q,
  currentQuestionType: 'seance-board',
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
  judgedResult,
});

const returnSlot = (status: SlotStatus): ReturnSlotState => ({
  slotId: 'r1',
  conceptId: 'k1',
  returnNumber: 1,
  currentQuestionId: 'q2',
  currentQuestionType: 'rune-cipher',
  label: null,
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
});

const doorSlot = (status: SlotStatus): FinalDoorSlotState => ({
  slotId: 'd1',
  origin: 'reserved',
  conceptId: 'k1',
  returnNumber: null,
  currentQuestionId: 'q2',
  currentQuestionType: 'rune-cipher',
  label: null,
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
});

const submitted = (slotId: string, selectedOptionId: string): Event => ({
  kind: 'AnswerSubmitted',
  slotId,
  submission: { selectedOptionId },
});

const CORRECT = ROOM_ANNOUNCEMENT_COPY.evidence.correct;
const WRONG = ROOM_PLAY_LABELS.wrongOpening;

describe('EvidencePanel', () => {
  const mount = useMount();

  function show(slot: EvidencePanelProps['slot'], extra: Partial<EvidencePanelProps> = {}): string {
    mount.render(
      <EvidencePanel slot={slot} content={CONTENT} chunks={CHUNKS} eventLog={[]} onContinue={() => undefined} {...extra} />,
    );
    return mount.container.textContent ?? '';
  }

  it.each<[string, EvidencePanelProps['slot'], 'correct' | 'wrong' | null]>([
    ['Lock_Slot correct', lockSlot('correct', 'solved'), 'correct'],
    ['Lock_Slot wrong', lockSlot('wrong', 'settled'), 'wrong'],
    ['Return_Slot solved', returnSlot('solved'), 'correct'],
    ['Return_Slot settled', returnSlot('settled'), 'wrong'],
    ['Return_Slot challenged', returnSlot('challenged'), null],
    ['Final_Door slot solved', doorSlot('solved'), 'correct'],
    ['Final_Door slot settled', doorSlot('settled'), 'wrong'],
    ['Final_Door slot challenged', doorSlot('challenged'), null],
  ])('result text for %s', (_name, slot, expected) => {
    const text = show(slot);
    expect(text.includes(CORRECT)).toBe(expected === 'correct');
    expect(text.includes(WRONG)).toBe(expected === 'wrong');
    expect(mount.container.querySelectorAll('.evidence-panel__result svg[aria-hidden="true"]')).toHaveLength(
      expected === null ? 0 : 1,
    );
    expect(text.includes(ROOM_PLAY_LABELS.challengedLabel)).toBe(slot.status === 'challenged');
  });

  it('opens with the kind sentence once for a wrong answer', () => {
    const text = show(lockSlot('wrong', 'settled'));
    expect(text.split(WRONG)).toHaveLength(2);
    expect(mount.container.querySelector('.evidence-panel__result')?.textContent).toContain(WRONG);
  });

  it('labels only matched excerpts and shows the explanation', () => {
    const text = show(lockSlot('correct', 'solved'));
    expect(text.split(ROOM_PLAY_LABELS.excerptMatched)).toHaveLength(3);
    const items = Array.from(mount.container.querySelectorAll('.evidence-panel__excerpt'));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.textContent?.includes(ROOM_PLAY_LABELS.excerptMatched))).toEqual([true, true, false]);
    expect(text).toContain('The aorta leaves the heart.');
  });

  it('shows chosen and key option texts, the chosen taken from the event log, chosen excerpt first', () => {
    const text = show(lockSlot('wrong', 'settled'), { eventLog: [submitted('s1', 'b')], keyOptionId: 'a' });
    expect(text).toContain(`${ROOM_PLAY_LABELS.evidenceChosenOption}: The vena cava`);
    expect(text).toContain(`${ROOM_PLAY_LABELS.evidenceKeyOption}: The aorta`);
    const quotes = Array.from(mount.container.querySelectorAll('blockquote')).map((q) => q.textContent);
    expect(quotes).toEqual([
      'This quote is not in the chunk',
      'The aorta carries blood from the heart.',
      'Valves stop blood flowing backwards.',
    ]);
  });

  it('shows no chosen option when the log has no submission for the slot', () => {
    const text = show(lockSlot('correct', 'solved'), { eventLog: [submitted('other', 'b')], keyOptionId: 'a' });
    expect(text).not.toContain(ROOM_PLAY_LABELS.evidenceChosenOption);
    expect(text).toContain(ROOM_PLAY_LABELS.evidenceKeyOption);
  });

  it('shows no option lines for a question without options', () => {
    const text = show(returnSlot('solved'), { eventLog: [submitted('r1', 'a')] });
    expect(text).not.toContain(ROOM_PLAY_LABELS.evidenceChosenOption);
  });

  it('offers only Continue, which calls onContinue', () => {
    const onContinue = vi.fn();
    show(lockSlot('wrong', 'settled'), { onContinue });
    expect(mount.container.querySelectorAll('input, textarea, select, form')).toHaveLength(0);
    expect(Array.from(mount.container.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      ROOM_PLAY_LABELS.continue,
    ]);
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.continue).click());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('never ends a Citation_Label in "of your notes" for sample crypts and has no banned phrase', () => {
    const text = show(lockSlot('wrong', 'settled'), { keyOptionId: 'a' });
    for (const label of mount.container.querySelectorAll('.evidence-panel__citation')) {
      expect(label.textContent).not.toMatch(/of your notes$/);
    }
    for (const phrase of BANNED_COPY_PHRASES) expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
  });
});
