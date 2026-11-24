import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import type { LockSlotState, State } from './state-types';

const manifest = buildManifest({
  rooms: 1,
  conceptsPerRoom: 2,
  lockTypes: ['rune-cipher', 'seance-board'],
  alternates: false,
});
const room = manifest.rooms[0];
const runeSpec = room?.lockSlots.find((s) => s.stationType === 'rune-cipher');
const seanceSpec = room?.lockSlots.find((s) => s.stationType === 'seance-board');
if (!room || !runeSpec || !seanceSpec) throw new Error('fixture');
const runeSlot = runeSpec.slotId;
const seanceSlot = seanceSpec.slotId;
const runePayload = runeSpec.primaryQuestion.payload as { answer: string };
const seancePayload = seanceSpec.primaryQuestion.payload as {
  optionIds: string[];
  keyOptionId: string;
};
const wrongOption = seancePayload.optionIds.find((o) => o !== seancePayload.keyOptionId) ?? '';

function run(state: State, ...events: Parameters<typeof apply>[1][]): State {
  let current = state;
  for (const event of events) {
    const result = apply(current, event);
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    current = result.state;
  }
  return current;
}

const ready = run(
  initial(manifest, SETTINGS),
  { kind: 'RunStarted', manifestId: manifest.manifestId },
  { kind: 'RoomPublished', roomId: room.roomId },
  { kind: 'RoomEntered', roomId: room.roomId },
);

function slotOf(state: State, slotId: string): LockSlotState {
  const slot = state.rooms[0]?.lockSlots.find((s) => s.slotId === slotId);
  if (!slot) throw new Error('slot');
  return slot;
}

function withHint(state: State, slotId: string, questionId: string, optionId: string): State {
  const rooms = state.rooms.map((r) => ({
    ...r,
    lockSlots: r.lockSlots.map((s) =>
      s.slotId === slotId
        ? { ...s, appliedHint: { questionId, effect: { kind: 'remove-option' as const, optionId } } }
        : s,
    ),
  }));
  return { ...state, rooms };
}

describe('AnswerSubmitted', () => {
  it('solves the slot, lights a candle and opens evidence on a correct answer', () => {
    const result = apply(ready, {
      kind: 'AnswerSubmitted',
      slotId: runeSlot,
      submission: { text: ` ${runePayload.answer.toUpperCase()} ` },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = slotOf(result.state, runeSlot);
    expect(slot).toMatchObject({
      status: 'solved',
      candleLit: true,
      evidencePanelOpen: true,
      judgedResult: 'correct',
    });
    expect(result.state.candleCount).toBe(1);
    expect(result.state.judgedAnswerCount).toBe(1);
    expect(result.notices).toEqual([
      { kind: 'candleLit', target: { type: 'slot', slotId: runeSlot } },
    ]);
    expect(result.state.ghosts).toEqual([]);
    expect(result.state.concepts.find((c) => c.conceptId === runeSpec.conceptId)).toMatchObject({
      shownQuestionIds: [runeSpec.primaryQuestion.questionId],
      firstQuestionResult: 'correct',
      hintUsedOnCorrectQuestion: false,
    });
  });

  it('settles the slot with no candle on a wrong answer', () => {
    const result = apply(ready, {
      kind: 'AnswerSubmitted',
      slotId: runeSlot,
      submission: { text: 'nothing like it' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.state, runeSlot)).toMatchObject({
      status: 'settled',
      candleLit: false,
      evidencePanelOpen: true,
      judgedResult: 'wrong',
    });
    expect(result.state.candleCount).toBe(0);
    expect(result.state.judgedAnswerCount).toBe(1);
    expect(result.notices).toEqual([{ kind: 'ghostSpawned', conceptId: runeSpec.conceptId }]);
    expect(result.state.ghosts).toHaveLength(1);
  });

  it('rejects an invalid submission and leaves State unchanged', () => {
    const before = JSON.stringify(ready);
    const result = apply(ready, {
      kind: 'AnswerSubmitted',
      slotId: runeSlot,
      submission: { text: '   ' },
    });
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-submission', slotId: runeSlot } });
    expect(JSON.stringify(ready)).toBe(before);
  });

  it('rejects a malformed submission without throwing', () => {
    const result = apply(ready, { kind: 'AnswerSubmitted', slotId: seanceSlot, submission: null });
    expect(result.ok).toBe(false);
  });

  it('rejects a second judged submit with lock-already-settled', () => {
    const after = run(ready, {
      kind: 'AnswerSubmitted',
      slotId: runeSlot,
      submission: { text: 'wrong' },
    });
    const again = apply(after, {
      kind: 'AnswerSubmitted',
      slotId: runeSlot,
      submission: { text: runePayload.answer },
    });
    expect(again).toEqual({ ok: false, error: { kind: 'lock-already-settled' } });
  });

  it('is a pure function of State and event', () => {
    const event = {
      kind: 'AnswerSubmitted' as const,
      slotId: seanceSlot,
      submission: { selectedOptionId: seancePayload.keyOptionId },
    };
    expect(apply(ready, event)).toEqual(apply(ready, event));
  });

  it('marks a correct answer assisted only when the hint was recorded for the shown question', () => {
    const qid = seanceSpec.primaryQuestion.questionId;
    const hinted = withHint(ready, seanceSlot, qid, wrongOption);
    const submit = {
      kind: 'AnswerSubmitted' as const,
      slotId: seanceSlot,
      submission: { selectedOptionId: seancePayload.keyOptionId },
    };
    const good = apply(hinted, submit);
    expect(good.ok && good.state.concepts.find((c) => c.conceptId === seanceSpec.conceptId)).toMatchObject({
      hintUsedOnCorrectQuestion: true,
    });

    // A hint recorded for another question is ignored: it neither assists nor removes options.
    const stale = withHint(ready, seanceSlot, 'some-other-question', seancePayload.keyOptionId);
    const staleResult = apply(stale, submit);
    expect(staleResult.ok).toBe(true);
    if (!staleResult.ok) return;
    expect(slotOf(staleResult.state, seanceSlot).judgedResult).toBe('correct');
    expect(
      staleResult.state.concepts.find((c) => c.conceptId === seanceSpec.conceptId)
        ?.hintUsedOnCorrectQuestion,
    ).toBe(false);
  });

  it('does not set the assisted flag on a wrong answer', () => {
    const qid = seanceSpec.primaryQuestion.questionId;
    const hinted = withHint(ready, seanceSlot, qid, seancePayload.keyOptionId === wrongOption ? '' : wrongOption);
    const other = seancePayload.optionIds.find(
      (o) => o !== seancePayload.keyOptionId && o !== wrongOption,
    );
    const result = apply(hinted, {
      kind: 'AnswerSubmitted',
      slotId: seanceSlot,
      submission: { selectedOptionId: other ?? '' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.state, seanceSlot).judgedResult).toBe('wrong');
    expect(
      result.state.concepts.find((c) => c.conceptId === seanceSpec.conceptId)
        ?.hintUsedOnCorrectQuestion,
    ).toBe(false);
  });

  it('emits roomCleared when the last slot is judged', () => {
    const first = run(ready, {
      kind: 'AnswerSubmitted',
      slotId: runeSlot,
      submission: { text: 'wrong' },
    });
    const last = apply(first, {
      kind: 'AnswerSubmitted',
      slotId: seanceSlot,
      submission: { selectedOptionId: seancePayload.keyOptionId },
    });
    expect(last.ok && last.notices.map((n) => n.kind)).toEqual(['candleLit', 'roomCleared']);
  });
});

describe('EvidenceContinued', () => {
  const answered = run(ready, {
    kind: 'AnswerSubmitted',
    slotId: runeSlot,
    submission: { text: 'wrong' },
  });

  it('closes the evidence panel', () => {
    const result = apply(answered, { kind: 'EvidenceContinued', slotId: runeSlot });
    expect(result.ok).toBe(true);
    if (result.ok) expect(slotOf(result.state, runeSlot).evidencePanelOpen).toBe(false);
  });

  it('returns no-evidence-open when no panel is open', () => {
    expect(apply(ready, { kind: 'EvidenceContinued', slotId: runeSlot })).toEqual({
      ok: false,
      error: { kind: 'no-evidence-open', slotId: runeSlot },
    });
    const closed = run(answered, { kind: 'EvidenceContinued', slotId: runeSlot });
    const again = apply(closed, { kind: 'EvidenceContinued', slotId: runeSlot });
    expect(again.ok).toBe(false);
  });
});
