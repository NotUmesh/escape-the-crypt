import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import type { Event } from '../types';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest, LockSlotSpec, QuestionSpec } from './manifest-types';
import type { LockSlotState, State } from './state-types';

function ok(state: State, event: Event) {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result;
}

function start(manifest: CryptManifest): State {
  const room = manifest.rooms[0];
  if (!room) throw new Error('fixture');
  let state = initial(manifest, SETTINGS);
  const events: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: room.roomId },
    { kind: 'RoomEntered', roomId: room.roomId },
  ];
  for (const event of events) state = ok(state, event).state;
  return state;
}

const withAlt = buildManifest({
  rooms: 1,
  conceptsPerRoom: 2,
  lockTypes: ['seance-board', 'cursed-object'],
  alternates: true,
  hintEffects: true,
});
const noAlt = buildManifest({ rooms: 1, conceptsPerRoom: 2, lockTypes: ['seance-board', 'cursed-object'], alternates: false });

function slots(manifest: CryptManifest) {
  const specs = manifest.rooms[0]?.lockSlots;
  const [first, second] = specs ?? [];
  if (!first || !second) throw new Error('fixture');
  return { first, second };
}

function slotOf(state: State, id: string): LockSlotState {
  const slot = state.rooms[0]?.lockSlots.find((s) => s.slotId === id);
  if (!slot) throw new Error('slot');
  return slot;
}

describe('Skipped', () => {
  it('settles the slot with no candle, no ghost and no judged answer', () => {
    const { first } = slots(withAlt);
    const before = start(withAlt);
    const { state, notices } = ok(before, { kind: 'Skipped', slotId: first.slotId });
    expect(slotOf(state, first.slotId)).toMatchObject({ status: 'settled', candleLit: false });
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    // The queue holds a deferred return (Req 16.3), but no ghost is announced (Req 16.2).
    expect(state.ghosts).toHaveLength(1);
    expect(notices).toEqual([]);
  });

  it('emits roomCleared when it settles the last open slot', () => {
    const { first, second } = slots(withAlt);
    const mid = ok(start(withAlt), { kind: 'Skipped', slotId: first.slotId }).state;
    const { state, notices } = ok(mid, { kind: 'Skipped', slotId: second.slotId });
    const roomId = withAlt.rooms[0]?.roomId;
    expect(notices).toEqual([{ kind: 'roomCleared', roomId }]);
    expect(state.rooms[0]?.cleared).toBe(true);
  });

  it('rejects a second skip on a settled slot', () => {
    const { first } = slots(withAlt);
    const mid = ok(start(withAlt), { kind: 'Skipped', slotId: first.slotId }).state;
    expect(apply(mid, { kind: 'Skipped', slotId: first.slotId })).toMatchObject({
      ok: false,
      error: { kind: 'lock-already-settled' },
    });
  });
});

describe('Challenged', () => {
  it('replaces the question in place with the unused Alternate', () => {
    const { first } = slots(withAlt);
    const alt = first.alternateQuestion;
    if (!alt) throw new Error('fixture');
    const hinted = ok(start(withAlt), { kind: 'HintUsed', slotId: first.slotId }).state;
    const { state, notices } = ok(hinted, { kind: 'Challenged', slotId: first.slotId });
    expect(slotOf(state, first.slotId)).toMatchObject({
      status: 'open',
      stationType: first.stationType,
      currentQuestionId: alt.questionId,
      currentQuestionType: alt.lockType,
      appliedHint: null,
      candleLit: false,
    });
    expect(notices).toEqual([{ kind: 'sealCracked', slotId: first.slotId }]);
    expect(state.remainingHints).toBe(hinted.remainingHints);
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    expect(state.ghosts).toEqual([]);
    const concept = state.concepts.find((c) => c.conceptId === first.conceptId);
    expect(concept).toMatchObject({ alternateUsed: true, firstQuestionResult: 'challenged' });
    expect(concept?.shownQuestionIds).toContain(alt.questionId);
  });

  it('challenges the Alternate: slot becomes challenged', () => {
    const { first } = slots(withAlt);
    const replaced = ok(start(withAlt), { kind: 'Challenged', slotId: first.slotId }).state;
    const { state, notices } = ok(replaced, { kind: 'Challenged', slotId: first.slotId });
    expect(slotOf(state, first.slotId).status).toBe('challenged');
    expect(notices).toEqual([{ kind: 'sealCracked', slotId: first.slotId }]);
    const concept = state.concepts.find((c) => c.conceptId === first.conceptId);
    expect(concept).toMatchObject({ alternateChallenged: true, alternateResult: 'challenged' });
  });

  it('settles as challenged when there is no Alternate', () => {
    const { first } = slots(noAlt);
    const { state } = ok(start(noAlt), { kind: 'Challenged', slotId: first.slotId });
    expect(slotOf(state, first.slotId)).toMatchObject({ status: 'challenged', candleLit: false });
    expect(state.candleCount).toBe(0);
    expect(state.ghosts).toEqual([]);
  });

  it('emits sealCracked then roomCleared when it settles the last slot', () => {
    const { first, second } = slots(noAlt);
    const mid = ok(start(noAlt), { kind: 'Skipped', slotId: first.slotId }).state;
    const { state, notices } = ok(mid, { kind: 'Challenged', slotId: second.slotId });
    expect(notices).toEqual([
      { kind: 'sealCracked', slotId: second.slotId },
      { kind: 'roomCleared', roomId: noAlt.rooms[0]?.roomId },
    ]);
    expect(state.rooms[0]?.cleared).toBe(true);
  });

  it('rejects a challenge on an unknown or settled slot, leaving State unchanged', () => {
    const { first } = slots(noAlt);
    const settled = ok(start(noAlt), { kind: 'Challenged', slotId: first.slotId }).state;
    const snapshot = JSON.stringify(settled);
    expect(apply(settled, { kind: 'Challenged', slotId: first.slotId })).toMatchObject({
      ok: false,
      error: { kind: 'lock-already-settled' },
    });
    expect(apply(settled, { kind: 'Challenged', slotId: 'nope' })).toMatchObject({
      ok: false,
      error: { kind: 'unknown-reference' },
    });
    expect(JSON.stringify(settled)).toBe(snapshot);
  });
});

describe('deferred skips and challenges on Return_Slots', () => {
  const big = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true });
  const bigSlots = big.rooms[0]?.lockSlots ?? [];
  const [b1, b2, b3, b4] = bigSlots as [LockSlotSpec, LockSlotSpec, LockSlotSpec, LockSlotSpec];
  const questions = new Map<string, QuestionSpec>(
    bigSlots.flatMap((s) =>
      [s.primaryQuestion, s.alternateQuestion].flatMap((q) => (q ? [[q.questionId, q] as const] : [])),
    ),
  );
  const returnId = `return-${b1.conceptId}-1`;

  function answerCorrect(state: State, slotId: string): State {
    const room = state.rooms[0];
    const id =
      room?.lockSlots.find((s) => s.slotId === slotId)?.currentQuestionId ??
      room?.dueReturnSlots.find((s) => s.slotId === slotId)?.currentQuestionId ??
      '';
    const q = questions.get(id);
    if (!q) throw new Error('question');
    return ok(state, { kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, true) }).state;
  }

  function answerWrong(state: State, slotId: string): State {
    const id = state.rooms[0]?.lockSlots.find((s) => s.slotId === slotId)?.currentQuestionId ?? '';
    const q = questions.get(id);
    if (!q) throw new Error('question');
    return ok(state, { kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, false) }).state;
  }

  function concept(state: State, conceptId: string) {
    const c = state.concepts.find((r) => r.conceptId === conceptId);
    if (!c) throw new Error('concept');
    return c;
  }

  /** Skip slot 1, then three correct answers make the deferred return due. */
  function afterSkipAndThree(): State {
    const skipped = ok(start(big), { kind: 'Skipped', slotId: b1.slotId }).state;
    return [b2, b3, b4].reduce((s, spec) => answerCorrect(s, spec.slotId), skipped);
  }

  it('queues a deferred return 1 when a Lock_Slot with an unused Alternate is skipped', () => {
    const { state } = ok(start(big), { kind: 'Skipped', slotId: b1.slotId });
    expect(state.ghosts).toEqual([
      { conceptId: b1.conceptId, returnNumber: 1, judgedAnswerCountAtSpawn: 0, due: false },
    ]);
    expect(concept(state, b1.conceptId).reviewDueFlag).toBe(false);
  });

  it('turns the deferred return into an unlabelled Alternate Return_Slot once due; correct counts as retried', () => {
    const due = afterSkipAndThree();
    const slot = due.rooms[0]?.dueReturnSlots[0];
    expect(slot).toMatchObject({
      slotId: returnId,
      returnNumber: 1,
      currentQuestionId: b1.alternateQuestion?.questionId,
      label: null,
      status: 'open',
    });
    const solved = answerCorrect(due, returnId);
    expect(concept(solved, b1.conceptId).return1Result).toBe('correct');
    expect(solved.rooms[0]?.spiritCandles).toHaveLength(1);
  });

  it('treats a deferred return judged wrong as a return 1 wrong answer', () => {
    const due = afterSkipAndThree();
    const q = due.rooms[0]?.dueReturnSlots[0];
    const question = q ? questions.get(q.currentQuestionId) : undefined;
    if (!question) throw new Error('question');
    const { state } = ok(due, {
      kind: 'AnswerSubmitted',
      slotId: returnId,
      submission: submissionFor(question, false),
    });
    expect(concept(state, b1.conceptId).return1Result).toBe('wrong');
    expect(state.ghosts).toEqual([
      { conceptId: b1.conceptId, returnNumber: 2, judgedAnswerCountAtSpawn: 4, due: false },
    ]);
  });

  it('sets the Review_Due_Flag and queues nothing when skipping a Lock_Slot with no Alternate', () => {
    const { first } = slots(noAlt);
    const { state } = ok(start(noAlt), { kind: 'Skipped', slotId: first.slotId });
    expect(state.ghosts).toEqual([]);
    expect(concept(state, first.conceptId)).toMatchObject({
      reviewDueFlag: true,
      wasSkippedWithNoAlternate: true,
    });
  });

  it('sets the Review_Due_Flag when a Return_Slot is skipped after its Alternate was used', () => {
    const due = afterSkipAndThree();
    const { state, notices } = ok(due, { kind: 'Skipped', slotId: returnId });
    expect(state.rooms[0]?.dueReturnSlots[0]).toMatchObject({ status: 'settled', candleLit: false });
    expect(state.ghosts).toEqual([]);
    expect(concept(state, b1.conceptId).reviewDueFlag).toBe(true);
    expect(notices.some((n) => n.kind === 'ghostSpawned')).toBe(false);
    expect(state.candleCount).toBe(3);
  });

  it('settles a challenged Return_Slot as challenged and records Review due after an earlier wrong answer', () => {
    const wrongFirst = [b2, b3, b4].reduce(
      (s, spec) => answerCorrect(s, spec.slotId),
      answerWrong(start(big), b1.slotId),
    );
    expect(wrongFirst.rooms[0]?.dueReturnSlots[0]?.slotId).toBe(returnId);
    const { state, notices } = ok(wrongFirst, { kind: 'Challenged', slotId: returnId });
    expect(state.rooms[0]?.dueReturnSlots[0]).toMatchObject({ status: 'challenged', candleLit: false });
    expect(notices).toEqual([{ kind: 'sealCracked', slotId: returnId }]);
    expect(state.ghosts).toEqual([]);
    expect(state.candleCount).toBe(wrongFirst.candleCount);
    expect(state.judgedAnswerCount).toBe(wrongFirst.judgedAnswerCount);
    expect(concept(state, b1.conceptId)).toMatchObject({
      return1Result: 'challenged',
      reviewDueFlag: true,
    });
  });

  it('records Review due when a deferred return that followed a skip is challenged', () => {
    const { state } = ok(afterSkipAndThree(), { kind: 'Challenged', slotId: returnId });
    expect(state.rooms[0]?.dueReturnSlots[0]?.status).toBe('challenged');
    expect(concept(state, b1.conceptId)).toMatchObject({ return1Result: 'challenged', reviewDueFlag: true });
  });
});
