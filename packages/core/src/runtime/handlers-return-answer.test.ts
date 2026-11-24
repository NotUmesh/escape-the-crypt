import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import type { ApplyResult } from './apply';
import { GHOST_DELAY } from './ghost-queue';
import { initial } from './initial';
import type { QuestionSpec } from './manifest-types';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true });
const room = manifest.rooms[0];
if (!room) throw new Error('fixture');
const questions = new Map<string, QuestionSpec>(
  room.lockSlots.flatMap((s) =>
    [s.primaryQuestion, s.alternateQuestion].flatMap((q) => (q ? [[q.questionId, q] as const] : [])),
  ),
);
const slotIds = room.lockSlots.map((s) => s.slotId);
const [s1, s2, s3, s4, s5, s6] = slotIds as [string, string, string, string, string, string];
const concept1 = room.lockSlots[0]?.conceptId ?? '';

function shownQuestion(state: State, slotId: string): QuestionSpec {
  const r = state.rooms[0];
  const id =
    r?.lockSlots.find((s) => s.slotId === slotId)?.currentQuestionId ??
    r?.dueReturnSlots.find((s) => s.slotId === slotId)?.currentQuestionId ??
    '';
  const q = questions.get(id);
  if (!q) throw new Error(`no question for ${slotId}`);
  return q;
}

function answer(state: State, slotId: string, correct: boolean): ApplyResult {
  return apply(state, {
    kind: 'AnswerSubmitted',
    slotId,
    submission: submissionFor(shownQuestion(state, slotId), correct),
  });
}

function step(state: State, slotId: string, correct: boolean): State {
  const result = answer(state, slotId, correct);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result.state;
}

let started = initial(manifest, SETTINGS);
for (const event of [
  { kind: 'RunStarted' as const, manifestId: manifest.manifestId },
  { kind: 'RoomPublished' as const, roomId: room.roomId },
  { kind: 'RoomEntered' as const, roomId: room.roomId },
]) {
  const r = apply(started, event);
  if (!r.ok) throw new Error('setup');
  started = r.state;
}

/** First slot wrong, then three correct: the ghost is due at the third. */
const afterThree = [s2, s3].reduce((s, id) => step(s, id, true), step(started, s1, false));
const returnId = `return-${concept1}-1`;

describe('wrong answers spawn ghosts', () => {
  it('spawns a ghost on a wrong first answer and emits ghostSpawned', () => {
    const result = answer(started, s1, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notices).toEqual([{ kind: 'ghostSpawned', conceptId: concept1 }]);
    expect(result.state.ghosts).toEqual([
      { conceptId: concept1, returnNumber: 1, judgedAnswerCountAtSpawn: 1, due: false },
    ]);
  });

  it('holds the ghost until GHOST_DELAY judged answers have passed', () => {
    expect(GHOST_DELAY).toBe(3);
    expect(afterThree.ghosts).toHaveLength(1);
    expect(afterThree.rooms[0]?.dueReturnSlots).toEqual([]);
  });
});

describe('Return_Slots', () => {
  const withReturn = step(afterThree, s4, true);
  const returnSlot = withReturn.rooms[0]?.dueReturnSlots[0];

  it('adds an unlabelled Alternate return in the room once the ghost is due', () => {
    expect(withReturn.ghosts).toEqual([]);
    expect(returnSlot).toMatchObject({
      slotId: returnId,
      conceptId: concept1,
      returnNumber: 1,
      label: null,
      status: 'open',
    });
    expect(returnSlot?.currentQuestionId).toBe(room.lockSlots[0]?.alternateQuestion?.questionId);
    expect(withReturn.rooms[0]?.lockSlots.map((s) => s.slotId)).toEqual(slotIds);
  });

  it('keeps the room uncleared while the return is open', () => {
    const done = [s5, s6].reduce((s, id) => step(s, id, true), withReturn);
    expect(done.rooms[0]?.cleared).toBe(false);
  });

  it('adds the return before clearing when the last lock slot is answered', () => {
    const skipped = [s5, s6].reduce((s, id) => {
      const r = apply(s, { kind: 'Skipped', slotId: id });
      if (!r.ok) throw new Error('skip');
      return r.state;
    }, afterThree);
    expect(skipped.rooms[0]?.dueReturnSlots).toHaveLength(0);
    const nearlyDone = skipped;
    const last = answer(nearlyDone, s4, true);
    expect(last.ok && last.state.rooms[0]).toMatchObject({ cleared: false });
    expect(last.ok && last.state.rooms[0]?.dueReturnSlots).toHaveLength(1);
    expect(last.ok && last.notices.map((n) => n.kind)).toEqual(['candleLit']);
  });

  it('on a correct return: solves it, lights a spirit candle, leaves the missed lock unlit', () => {
    const settled = [s5, s6].reduce((s, id) => step(s, id, true), withReturn);
    const result = answer(settled, returnId, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.state.rooms[0];
    expect(r?.dueReturnSlots[0]).toMatchObject({ status: 'solved', candleLit: true });
    expect(r?.spiritCandles).toEqual([{ conceptId: concept1, returnSlotId: returnId }]);
    expect(r?.lockSlots[0]).toMatchObject({ status: 'settled', candleLit: false });
    expect(result.state.candleCount).toBe(6);
    expect(result.notices).toEqual([
      { kind: 'candleLit', target: { type: 'spirit', roomId: room.roomId } },
      { kind: 'ghostLaidToRest', conceptId: concept1 },
      { kind: 'roomCleared', roomId: room.roomId },
    ]);
    expect(result.state.concepts.find((c) => c.conceptId === concept1)?.return1Result).toBe('correct');
  });

  it('on a wrong return 1: spawns return 2; on a wrong return 2: lingering spirit and review due', () => {
    const wrong1 = answer(withReturn, returnId, false);
    expect(wrong1.ok).toBe(true);
    if (!wrong1.ok) return;
    expect(wrong1.notices).toEqual([{ kind: 'ghostSpawned', conceptId: concept1 }]);
    expect(wrong1.state.ghosts).toEqual([
      { conceptId: concept1, returnNumber: 2, judgedAnswerCountAtSpawn: 5, due: false },
    ]);
    expect(wrong1.state.candleCount).toBe(3);

    // Make return 2 due, then settle another slot: it is added before the room can clear.
    const due: State = {
      ...wrong1.state,
      ghosts: wrong1.state.ghosts.map((g) => ({ ...g, judgedAnswerCountAtSpawn: -10 })),
    };
    const afterFive = step(due, s5, true);
    const second = afterFive.rooms[0]?.dueReturnSlots.find((s) => s.returnNumber === 2);
    expect(second).toMatchObject({ label: 'review', status: 'open' });
    expect(second?.currentQuestionId).toBe(room.lockSlots[0]?.primaryQuestion.questionId);
    expect(afterFive.rooms[0]?.cleared).toBe(false);

    const wrong2 = answer(step(afterFive, s6, true), `return-${concept1}-2`, false);
    expect(wrong2.ok).toBe(true);
    if (!wrong2.ok) return;
    const record = wrong2.state.concepts.find((c) => c.conceptId === concept1);
    expect(record).toMatchObject({ isLingeringSpirit: true, reviewDueFlag: true, return2Result: 'wrong' });
    expect(wrong2.state.ghosts).toEqual([]);
    expect(wrong2.state.rooms[0]?.cleared).toBe(true);
    expect(wrong2.notices).toEqual([{ kind: 'roomCleared', roomId: room.roomId }]);
  });

  it('closes the evidence panel of a return slot', () => {
    const wrong = step(withReturn, returnId, false);
    const closed = apply(wrong, { kind: 'EvidenceContinued', slotId: returnId });
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.state.rooms[0]?.dueReturnSlots[0]?.evidencePanelOpen).toBe(false);
    expect(apply(closed.ok ? closed.state : wrong, { kind: 'EvidenceContinued', slotId: returnId }).ok).toBe(false);
  });
});
