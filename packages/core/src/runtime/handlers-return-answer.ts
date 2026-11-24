import type { Event } from '../types';
import { hasEligibleReturnQuestion, spawnGhost } from './ghost-queue';
import type { QuestionSpec } from './manifest-types';
import { candleLitForSpirit, ghostLaidToRest, ghostSpawned, orderNotices } from './notices';
import type { Outcome_Notice } from './notices';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import { findSpecByConcept, settleRoom } from './room-clearing';
import { runJudge } from './run-judge';
import type { ConceptRecord, ReturnSlotState, State } from './state-types';

type AnswerSubmittedEvent = Extract<Event, { kind: 'AnswerSubmitted' }>;

export interface ReturnSlotLocation {
  readonly roomIndex: number;
  readonly slot: ReturnSlotState;
}

export function findReturnSlot(state: State, slotId: string): ReturnSlotLocation | null {
  for (let roomIndex = 0; roomIndex < state.rooms.length; roomIndex += 1) {
    const slot = state.rooms[roomIndex]?.dueReturnSlots.find((s) => s.slotId === slotId);
    if (slot !== undefined) return { roomIndex, slot };
  }
  return null;
}

/** The question a Return_Slot shows: the concept's primary or Alternate. */
function findReturnQuestion(state: State, slot: ReturnSlotState): QuestionSpec | null {
  for (const room of state.manifest.rooms) {
    for (const spec of room.lockSlots) {
      if (spec.conceptId !== slot.conceptId) continue;
      if (spec.primaryQuestion.questionId === slot.currentQuestionId) return spec.primaryQuestion;
      if (spec.alternateQuestion?.questionId === slot.currentQuestionId) return spec.alternateQuestion;
    }
  }
  return null;
}

function conceptAfterReturn(
  record: ConceptRecord,
  slot: ReturnSlotState,
  result: 'correct' | 'wrong',
  assisted: boolean,
): ConceptRecord {
  const base: ConceptRecord = {
    ...record,
    hintUsedOnCorrectQuestion: record.hintUsedOnCorrectQuestion || (result === 'correct' && assisted),
  };
  if (slot.returnNumber === 1) return { ...base, return1Result: result };
  const lingering = result === 'wrong';
  return {
    ...base,
    return2Result: result,
    isLingeringSpirit: base.isLingeringSpirit || lingering,
    reviewDueFlag: base.reviewDueFlag || lingering,
  };
}

/**
 * Judge an answer on a Return_Slot (Req 13.6, 13.7, 14.4 to 14.6). Correct lights a
 * Spirit_Candle in the room and leaves the missed Lock_Slot's own candle unlit. Wrong on
 * return 1 spawns return 2; wrong on return 2 makes the concept a Lingering_Spirit.
 */
export function handleReturnAnswer(
  state: State,
  event: AnswerSubmittedEvent,
  located: ReturnSlotLocation,
): ApplyResult {
  const { roomIndex, slot } = located;
  const room = state.rooms[roomIndex];
  if (room === undefined) return reject('unknown-reference');
  if (slot.status !== 'open') return reject('lock-already-settled');
  const question = findReturnQuestion(state, slot);
  if (question === null) return reject('unknown-reference');

  const hint = slot.appliedHint?.questionId === slot.currentQuestionId ? slot.appliedHint : null;
  const result = runJudge(slot.currentQuestionType, question.payload, event.submission, hint?.effect ?? null);
  if (result === 'invalid') return reject('invalid-submission', { slotId: slot.slotId });

  const correct = result === 'correct';
  const judgedCount = state.judgedAnswerCount + 1;
  const updatedSlot: ReturnSlotState = {
    ...slot,
    status: correct ? 'solved' : 'settled',
    candleLit: correct,
    evidencePanelOpen: true,
  };
  const rooms = state.rooms.map((r, i) =>
    i === roomIndex
      ? {
          ...r,
          dueReturnSlots: r.dueReturnSlots.map((s) => (s.slotId === slot.slotId ? updatedSlot : s)),
          spiritCandles: correct
            ? [...r.spiritCandles, { conceptId: slot.conceptId, returnSlotId: slot.slotId }]
            : r.spiritCandles,
        }
      : r,
  );
  let concepts = state.concepts.map((c) =>
    c.conceptId === slot.conceptId ? conceptAfterReturn(c, slot, result, hint !== null) : c,
  );

  const notices: Outcome_Notice[] = [];
  let ghosts = state.ghosts;
  if (correct) {
    notices.push(candleLitForSpirit(room.roomId), ghostLaidToRest(slot.conceptId));
  } else if (slot.returnNumber === 1) {
    const updated = concepts.find((c) => c.conceptId === slot.conceptId);
    const eligible =
      updated !== undefined &&
      hasEligibleReturnQuestion(findSpecByConcept(state, slot.conceptId), updated, 2);
    if (eligible) {
      const spawned = spawnGhost(ghosts, slot.conceptId, 2, judgedCount);
      if (spawned.ok) {
        ghosts = spawned.ghosts;
        notices.push(ghostSpawned(slot.conceptId));
      }
    } else {
      concepts = concepts.map((c) => (c.conceptId === slot.conceptId ? { ...c, reviewDueFlag: true } : c));
    }
  }

  const judged: State = {
    ...state,
    rooms,
    concepts,
    ghosts,
    judgedAnswerCount: judgedCount,
    candleCount: state.candleCount + (correct ? 1 : 0),
  };
  const cleared = settleRoom(judged, room.roomId);
  return accept(cleared.state, orderNotices([...notices, ...cleared.notices]));
}
