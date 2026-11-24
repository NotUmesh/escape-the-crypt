import { judgeRegistry } from '../locks/judge-registry';
import type {
  BoneOrderingQuestion,
  BoneOrderingSubmission,
  BoundThreadsQuestion,
  BoundThreadsSubmission,
  CombinationDialQuestion,
  CombinationDialSubmission,
  CursedObjectQuestion,
  CursedObjectSubmission,
  RuneCipherQuestion,
  RuneCipherSubmission,
  SeanceBoardQuestion,
  SeanceBoardSubmission,
} from '../locks/judge-registry';
import type { Event, HintEffectSpec, JudgeResult, LockType } from '../types';
import { candleLitForSlot, orderNotices } from './notices';
import type { QuestionSpec } from './manifest-types';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import { updateRoomCleared } from './room-clearing';
import type { ConceptRecord, LockSlotState, State } from './state-types';

type AnswerSubmittedEvent = Extract<Event, { kind: 'AnswerSubmitted' }>;
type EvidenceContinuedEvent = Extract<Event, { kind: 'EvidenceContinued' }>;

/**
 * Run the judge for one lock type. The judges are total; the try/catch is a last guard so
 * a malformed payload or submission becomes `invalid` instead of an exception.
 */
function runJudge(
  lockType: LockType,
  payload: unknown,
  submission: unknown,
  hint: HintEffectSpec | null,
): JudgeResult {
  try {
    switch (lockType) {
      case 'rune-cipher':
        return judgeRegistry[lockType](
          payload as RuneCipherQuestion,
          submission as RuneCipherSubmission,
          hint,
        );
      case 'seance-board':
        return judgeRegistry[lockType](
          payload as SeanceBoardQuestion,
          submission as SeanceBoardSubmission,
          hint,
        );
      case 'bone-ordering':
        return judgeRegistry[lockType](
          payload as BoneOrderingQuestion,
          submission as BoneOrderingSubmission,
          hint,
        );
      case 'bound-threads':
        return judgeRegistry[lockType](
          payload as BoundThreadsQuestion,
          submission as BoundThreadsSubmission,
          hint,
        );
      case 'cursed-object':
        return judgeRegistry[lockType](
          payload as CursedObjectQuestion,
          submission as CursedObjectSubmission,
          hint,
        );
      case 'combination-dial':
        return judgeRegistry[lockType](
          payload as CombinationDialQuestion,
          submission as CombinationDialSubmission,
          hint,
        );
    }
  } catch {
    return 'invalid';
  }
}

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
  if (located === null) return reject('unknown-reference');
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
  const concepts = updateConcept(state.concepts, found.conceptId, (c) => ({
    ...c,
    firstQuestionResult: found.isPrimary ? result : c.firstQuestionResult,
    alternateResult: found.isPrimary ? c.alternateResult : result,
    hintUsedOnCorrectQuestion: c.hintUsedOnCorrectQuestion || (correct && hint !== null),
  }));
  const judged: State = {
    ...state,
    rooms,
    concepts,
    judgedAnswerCount: state.judgedAnswerCount + 1,
    candleCount: state.candleCount + (correct ? 1 : 0),
  };
  const room = rooms[roomIndex];
  const cleared =
    room === undefined ? { state: judged, notices: [] } : updateRoomCleared(judged, room.roomId);
  const notices = correct ? [candleLitForSlot(slot.slotId), ...cleared.notices] : cleared.notices;
  return accept(cleared.state, orderNotices(notices));
}

/** Close the evidence panel of a slot (Req 10.5). */
export function handleEvidenceContinued(state: State, event: EvidenceContinuedEvent): ApplyResult {
  const located = findLockSlot(state, event.slotId);
  if (located === null) return reject('unknown-reference');
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
