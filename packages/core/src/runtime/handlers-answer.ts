import type { Event } from '../types';
import { findDoorSlot } from './final-door-slots';
import { handleDoorAnswer, handleDoorEvidenceContinued } from './handlers-final-door';
import { hasEligibleReturnQuestion, recordQuestionShown, spawnGhost } from './ghost-queue';
import { findReturnSlot, handleReturnAnswer } from './handlers-return-answer';
import { candleLitForSlot, ghostSpawned, orderNotices } from './notices';
import type { QuestionSpec } from './manifest-types';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import { findSpecByConcept, settleRoom } from './room-clearing';
import { runJudge } from './run-judge';
import type { ConceptRecord, LockSlotState, State } from './state-types';

type AnswerSubmittedEvent = Extract<Event, { kind: 'AnswerSubmitted' }>;
type EvidenceContinuedEvent = Extract<Event, { kind: 'EvidenceContinued' }>;

interface LockSlotLocation {
  readonly roomIndex: number;
  readonly slotIndex: number;
  readonly slot: LockSlotState;
}

function findLockSlot(state: State, slotId: string): LockSlotLocation | null {
  for (let roomIndex = 0; roomIndex < state.rooms.length; roomIndex += 1) {
    const slots = state.rooms[roomIndex]?.lockSlots ?? [];
    const slotIndex = slots.findIndex((s) => s.slotId === slotId);
    const slot = slots[slotIndex];
    if (slot !== undefined) return { roomIndex, slotIndex, slot };
  }
  return null;
}

/** The manifest question and its concept, for the question a Lock_Slot currently shows. */
function findQuestion(
  state: State,
  slotId: string,
  questionId: string,
): { readonly question: QuestionSpec; readonly conceptId: string; readonly isPrimary: boolean } | null {
  for (const room of state.manifest.rooms) {
    for (const spec of room.lockSlots) {
      if (spec.slotId !== slotId) continue;
      if (spec.primaryQuestion.questionId === questionId) {
        return { question: spec.primaryQuestion, conceptId: spec.conceptId, isPrimary: true };
      }
      if (spec.alternateQuestion?.questionId === questionId) {
        return { question: spec.alternateQuestion, conceptId: spec.conceptId, isPrimary: false };
      }
    }
  }
  return null;
}

function updateConcept(
  concepts: readonly ConceptRecord[],
  conceptId: string,
  change: (c: ConceptRecord) => ConceptRecord,
): readonly ConceptRecord[] {
  return concepts.map((c) => (c.conceptId === conceptId ? change(c) : c));
}

/**
 * Judge an answer on a Lock_Slot (Req 10, 13). The result depends only on State and the
 * event. Invalid submissions are rejected and change nothing.
 */
export function handleAnswerSubmitted(state: State, event: AnswerSubmittedEvent): ApplyResult {
  const located = findLockSlot(state, event.slotId);
  if (located === null) {
    const returned = findReturnSlot(state, event.slotId);
    if (returned !== null) return handleReturnAnswer(state, event, returned);
    const door = findDoorSlot(state, event.slotId);
    return door === null ? reject('unknown-reference') : handleDoorAnswer(state, event, door);
  }
  const { roomIndex, slotIndex, slot } = located;
  if (slot.status !== 'open') return reject('lock-already-settled');

  const found = findQuestion(state, slot.slotId, slot.currentQuestionId);
  if (found === null) return reject('unknown-reference');

  // A hint counts only for the question it was recorded for (Req 18.5).
  const hint = slot.appliedHint?.questionId === slot.currentQuestionId ? slot.appliedHint : null;
  const result = runJudge(
    slot.currentQuestionType,
    found.question.payload,
    event.submission,
    hint?.effect ?? null,
  );
  if (result === 'invalid') return reject('invalid-submission', { slotId: slot.slotId });

  const correct = result === 'correct';
  const updatedSlot: LockSlotState = {
    ...slot,
    status: correct ? 'solved' : 'settled',
    candleLit: correct,
    evidencePanelOpen: true,
    judgedResult: result,
  };
  const rooms = state.rooms.map((room, i) =>
    i === roomIndex
      ? {
          ...room,
          lockSlots: room.lockSlots.map((s, j) => (j === slotIndex ? updatedSlot : s)),
        }
      : room,
  );
  const concepts = updateConcept(state.concepts, found.conceptId, (shown) => {
    const c = recordQuestionShown(shown, slot.currentQuestionId);
    return {
    ...c,
    firstQuestionResult: found.isPrimary ? result : c.firstQuestionResult,
    alternateResult: found.isPrimary ? c.alternateResult : result,
    hintUsedOnCorrectQuestion: c.hintUsedOnCorrectQuestion || (correct && hint !== null),
    };
  });
  const judgedCount = state.judgedAnswerCount + 1;
  // A wrong answer spawns a ghost counted from this judged answer (Req 14.1, 15.2), unless no
  // unchallenged question is left for the Return: then the concept is review due (Req 14.11).
  const updatedRecord = concepts.find((c) => c.conceptId === found.conceptId);
  const eligible =
    updatedRecord !== undefined &&
    hasEligibleReturnQuestion(findSpecByConcept(state, found.conceptId), updatedRecord, 1);
  const spawned = correct || !eligible ? null : spawnGhost(state.ghosts, found.conceptId, 1, judgedCount);
  const judged: State = {
    ...state,
    rooms,
    concepts:
      correct || eligible
        ? concepts
        : updateConcept(concepts, found.conceptId, (c) => ({ ...c, reviewDueFlag: true })),
    ghosts: spawned?.ok === true ? spawned.ghosts : state.ghosts,
    judgedAnswerCount: judgedCount,
    candleCount: state.candleCount + (correct ? 1 : 0),
  };
  const room = rooms[roomIndex];
  const cleared = room === undefined ? { state: judged, notices: [] } : settleRoom(judged, room.roomId);
  const notices = [
    ...(correct ? [candleLitForSlot(slot.slotId)] : []),
    ...(spawned?.ok === true ? [ghostSpawned(found.conceptId)] : []),
    ...cleared.notices,
  ];
  return accept(cleared.state, orderNotices(notices));
}

/** Close the evidence panel of a slot (Req 10.5). */
export function handleEvidenceContinued(state: State, event: EvidenceContinuedEvent): ApplyResult {
  const located = findLockSlot(state, event.slotId);
  if (located === null) {
    const returned = findReturnSlot(state, event.slotId);
    if (returned === null) return handleDoorEvidenceContinued(state, event.slotId) ?? reject('unknown-reference');
    if (!returned.slot.evidencePanelOpen) {
      return reject('no-evidence-open', { slotId: returned.slot.slotId });
    }
    const rooms = state.rooms.map((room) => ({
      ...room,
      dueReturnSlots: room.dueReturnSlots.map((s) =>
        s.slotId === event.slotId ? { ...s, evidencePanelOpen: false } : s,
      ),
    }));
    return accept({ ...state, rooms });
  }
  const { roomIndex, slotIndex, slot } = located;
  if (!slot.evidencePanelOpen) return reject('no-evidence-open', { slotId: slot.slotId });
  const rooms = state.rooms.map((room, i) =>
    i === roomIndex
      ? {
          ...room,
          lockSlots: room.lockSlots.map((s, j) =>
            j === slotIndex ? { ...s, evidencePanelOpen: false } : s,
          ),
        }
      : room,
  );
  return accept({ ...state, rooms });
}
