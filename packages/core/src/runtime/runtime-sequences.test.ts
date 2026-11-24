import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import {
  clearRoomCorrectly,
  passDoor,
  questionMap,
  shownQuestionId,
  startRun as start,
  step,
} from '../test-support/sequence-support';
import type { Step } from '../test-support/sequence-support';
import { apply } from './apply';
import type { CryptManifest } from './manifest-types';
import { selectWaitingForNextRoom } from './selectors';
import type { ConceptRecord, ReturnSlotState, State } from './state-types';

/** Drives one fixed manifest; every call applies one event and fails the test on a rejection. */
function driver(manifest: CryptManifest) {
  const questions = questionMap(manifest);
  const room = (s: State) => s.rooms[0];
  const run = step;
  const answer = (state: State, slotId: string, correct: boolean): Step => {
    const q = questions.get(shownQuestionId(state, slotId));
    if (!q) throw new Error('question');
    return run(state, { kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, correct) });
  };
  const openReturns = (s: State): readonly ReturnSlotState[] =>
    (room(s)?.dueReturnSlots ?? []).filter((x) => x.status === 'open');
  /** Answer wrong on the first open Return_Slot until none is open. */
  const drainWrong = (state: State): State => {
    let current = state;
    for (let guard = 0; guard < 50; guard += 1) {
      const next = openReturns(current)[0];
      if (!next) return current;
      current = answer(current, next.slotId, false).state;
    }
    throw new Error('drain did not end');
  };
  return { run, answer, openReturns, drainWrong, room };
}

function concept(state: State, conceptId: string): ConceptRecord {
  const c = state.concepts.find((x) => x.conceptId === conceptId);
  if (!c) throw new Error(`no concept ${conceptId}`);
  return c;
}

describe('named sequence: all wrong', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true });
  const specs = manifest.rooms[0]?.lockSlots ?? [];
  const d = driver(manifest);
  const c1 = specs[0]?.conceptId ?? '';
  const c1Slot = specs[0]?.slotId ?? '';

  it('spawns a ghost per miss and returns concept 1 on its Alternate, unlabelled', () => {
    let state = start(manifest);
    const first = d.answer(state, c1Slot, false);
    expect(first.notices).toEqual([{ kind: 'ghostSpawned', conceptId: c1 }]);
    state = first.state;
    for (const spec of specs.slice(1, 3)) state = d.answer(state, spec.slotId, false).state;
    expect(state.ghosts).toHaveLength(3);
    expect(d.openReturns(state)).toEqual([]);

    const fourth = d.answer(state, specs[3]?.slotId ?? '', false);
    const ret1 = d.openReturns(fourth.state)[0];
    expect(ret1).toMatchObject({
      slotId: `return-${c1}-1`,
      returnNumber: 1,
      label: null,
      currentQuestionId: specs[0]?.alternateQuestion?.questionId,
    });
    expect(fourth.state.rooms[0]?.lockSlots.map((s) => s.status)).toEqual(
      Array.from({ length: 4 }, () => 'settled').concat(['open', 'open']),
    );
  });

  it('labels return 2 "Review" on the primary and ends as a lingering spirit with zero candles', () => {
    let state = start(manifest);
    for (const spec of specs) state = d.answer(state, spec.slotId, false).state;
    expect(state.rooms[0]?.lockSlots.every((s) => s.status === 'settled' && !s.candleLit)).toBe(true);

    // Concept 1 returns first, wrong; its return 2 spawns and is due three judged answers later.
    const r1 = d.answer(state, `return-${c1}-1`, false);
    expect(r1.notices.map((n) => n.kind)).toEqual(['ghostSpawned']);
    expect(concept(r1.state, c1).return1Result).toBe('wrong');
    state = r1.state;
    const queued = state.ghosts.find((g) => g.conceptId === c1);
    expect(queued).toMatchObject({ returnNumber: 2, due: false });
    expect(d.openReturns(state).some((s) => s.slotId === `return-${c1}-2`)).toBe(false);

    // Answer the other open returns wrong; return 2 for concept 1 appears once enough have passed.
    while (!d.openReturns(state).some((s) => s.slotId === `return-${c1}-2`)) {
      const other = d.openReturns(state)[0];
      if (!other) throw new Error('return 2 never became due');
      state = d.answer(state, other.slotId, false).state;
    }
    const ret2 = d.openReturns(state).find((s) => s.slotId === `return-${c1}-2`);
    expect(ret2).toMatchObject({
      returnNumber: 2,
      label: 'review',
      currentQuestionId: specs[0]?.primaryQuestion.questionId,
    });

    const last = d.answer(state, `return-${c1}-2`, false);
    expect(last.notices.map((n) => n.kind)).not.toContain('ghostSpawned');
    expect(concept(last.state, c1)).toMatchObject({
      return2Result: 'wrong',
      isLingeringSpirit: true,
      reviewDueFlag: true,
    });
    expect(last.state.ghosts.some((g) => g.conceptId === c1)).toBe(false);

    const drained = d.drainWrong(last.state);
    expect(drained.candleCount).toBe(0);
    expect(drained.rooms[0]?.spiritCandles).toEqual([]);
    expect(drained.rooms[0]?.dueReturnSlots.every((s) => !s.candleLit)).toBe(true);
    expect(drained.rooms[0]?.cleared).toBe(true);

    // Escape is always possible: the Final_Door opens and answering it all wrong still escapes.
    const finalised = step(drained, { kind: 'CryptFinalised', finalRoomCount: 1 }).state;
    expect(finalised.finalDoor.available).toBe(true);
    const door = passDoor(manifest, finalised, 'wrong');
    expect(door.state.status).toBe('escaped');
    expect(door.notices.map((n) => n.kind)).toContain('escaped');
    expect(door.state.candleCount).toBe(0);
  });
});

describe('named sequence: all challenged with alternates', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true });
  const specs = manifest.rooms[0]?.lockSlots ?? [];
  const d = driver(manifest);

  it('replaces then closes every question with no candle, ghost or wrong answer', () => {
    let state = start(manifest);
    for (const spec of specs) {
      const alt = spec.alternateQuestion;
      const replaced = d.run(state, { kind: 'Challenged', slotId: spec.slotId });
      expect(replaced.notices).toEqual([{ kind: 'sealCracked', slotId: spec.slotId }]);
      const slot = replaced.state.rooms[0]?.lockSlots.find((s) => s.slotId === spec.slotId);
      expect(slot).toMatchObject({ status: 'open', currentQuestionId: alt?.questionId });
      const closed = d.run(replaced.state, { kind: 'Challenged', slotId: spec.slotId });
      const isLast = spec === specs[specs.length - 1];
      expect(closed.notices.map((n) => n.kind)).toEqual(
        isLast ? ['sealCracked', 'roomCleared'] : ['sealCracked'],
      );
      state = closed.state;
    }
    expect(state.rooms[0]?.lockSlots.every((s) => s.status === 'challenged' && !s.candleLit)).toBe(true);
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    expect(state.ghosts).toEqual([]);
    expect(state.rooms[0]?.dueReturnSlots).toEqual([]);
    expect(state.rooms[0]?.cleared).toBe(true);
    for (const c of state.concepts) {
      expect(c).toMatchObject({
        firstQuestionResult: 'challenged',
        alternateResult: 'challenged',
        return1Result: null,
        reviewDueFlag: false,
      });
    }

    // Escape with zero candles: every reserved door question is challenged.
    const finalised = step(state, { kind: 'CryptFinalised', finalRoomCount: 1 }).state;
    const door = passDoor(manifest, finalised, 'challenge');
    expect(door.state.status).toBe('escaped');
    expect(door.notices.map((n) => n.kind)).toContain('escaped');
    expect(door.state.candleCount).toBe(0);
  });
});

describe('named sequence: crypt shortened mid-run', () => {
  const manifest = buildManifest({ rooms: 5, conceptsPerRoom: 2 });
  const [r1, r2, r3, r4, r5] = manifest.rooms;
  if (!r1 || !r2 || !r3 || !r4 || !r5) throw new Error('fixture');

  it('opens the Final_Door after the new final count and leaves later rooms unpublished', () => {
    let state = start(manifest);
    state = clearRoomCorrectly(manifest, state, 0);
    state = step(state, { kind: 'RoomPublished', roomId: r2.roomId }).state;
    expect(state.rooms.filter((r) => r.published)).toHaveLength(2);

    // Below the published count is refused; at the published count it is accepted.
    expect(apply(state, { kind: 'CryptShortened', finalRoomCount: 1 })).toEqual({
      ok: false,
      error: { kind: 'cannot-shorten-published' },
    });
    state = step(state, { kind: 'CryptShortened', finalRoomCount: 3 }).state;
    expect(state.finalRoomCount).toBe(3);
    expect(state.finalDoor.available).toBe(false);

    state = step(state, { kind: 'RoomEntered', roomId: r2.roomId }).state;
    state = clearRoomCorrectly(manifest, state, 1);
    expect(state.finalDoor.available).toBe(false);
    state = step(state, { kind: 'RoomPublished', roomId: r3.roomId }).state;
    state = step(state, { kind: 'RoomEntered', roomId: r3.roomId }).state;
    state = clearRoomCorrectly(manifest, state, 2);

    expect(state.rooms.map((r) => r.cleared)).toEqual([true, true, true, false, false]);
    expect(state.rooms.map((r) => r.published)).toEqual([true, true, true, false, false]);
    expect(state.finalDoor.available).toBe(true);

    const door = passDoor(manifest, state, 'correct');
    expect(door.state.status).toBe('escaped');
    expect(door.state.candleCount).toBe(6 + manifest.finalDoor.slots.length);
  });
});

describe('named sequence: next room not yet published', () => {
  const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 2 });
  const room2 = manifest.rooms[1];
  if (!room2) throw new Error('fixture');

  it('waits after room 1 is Cleared, then accepts the publish and the entry', () => {
    let state = clearRoomCorrectly(manifest, start(manifest), 0);
    expect(state.rooms[0]?.cleared).toBe(true);
    expect(state.rooms[1]?.published).toBe(false);
    expect(selectWaitingForNextRoom(state)).toBe(true);
    expect(apply(state, { kind: 'RoomEntered', roomId: room2.roomId })).toEqual({
      ok: false,
      error: { kind: 'room-not-published' },
    });

    state = step(state, { kind: 'RoomPublished', roomId: room2.roomId }).state;
    expect(selectWaitingForNextRoom(state)).toBe(false);
    state = step(state, { kind: 'RoomEntered', roomId: room2.roomId }).state;
    expect(state.currentRoomId).toBe(room2.roomId);
  });
});

describe('named sequence: no alternates', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: false });
  const specs = manifest.rooms[0]?.lockSlots ?? [];
  const d = driver(manifest);
  const [a, b, c, e, f, g] = specs;
  const id = (spec: (typeof specs)[number] | undefined): string => spec?.conceptId ?? '';

  it('returns a miss on its primary labelled "Review" and flags Review due after return 2', () => {
    let state = start(manifest);
    state = d.answer(state, a?.slotId ?? '', false).state;
    state = d.run(state, { kind: 'Skipped', slotId: b?.slotId ?? '' }).state;
    expect(state.judgedAnswerCount).toBe(1);
    // A skip with no Alternate queues nothing and flags the concept at once.
    expect(state.ghosts.map((x) => x.conceptId)).toEqual([id(a)]);
    expect(concept(state, id(b))).toMatchObject({ wasSkippedWithNoAlternate: true, reviewDueFlag: true });
    for (const spec of [c, e, f]) state = d.answer(state, spec?.slotId ?? '', false).state;
    const ret1 = d.openReturns(state)[0];
    expect(ret1).toMatchObject({
      slotId: `return-${id(a)}-1`,
      label: 'review',
      currentQuestionId: a?.primaryQuestion.questionId,
    });
    state = d.answer(state, g?.slotId ?? '', true).state;
    expect(state.candleCount).toBe(1);

    state = d.drainWrong(state);
    expect(concept(state, id(a))).toMatchObject({
      return1Result: 'wrong',
      isLingeringSpirit: true,
      reviewDueFlag: true,
    });
    expect(state.rooms[0]?.dueReturnSlots.find((s) => s.slotId === `return-${id(a)}-2`)).toMatchObject({
      label: 'review',
      currentQuestionId: a?.primaryQuestion.questionId,
      status: 'settled',
    });
    // The skipped concept never gets a Return_Slot; only its flag remains.
    expect(state.rooms[0]?.dueReturnSlots.some((s) => s.conceptId === id(b))).toBe(false);
    expect(concept(state, id(b)).reviewDueFlag).toBe(true);
    expect(state.candleCount).toBe(1);
    expect(state.rooms[0]?.cleared).toBe(true);
  });
});
