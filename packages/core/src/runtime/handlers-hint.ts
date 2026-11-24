import type { Event } from '../types';
import type { QuestionSpec } from './manifest-types';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import type { AppliedHintState, State } from './state-types';

type HintUsedEvent = Extract<Event, { kind: 'HintUsed' }>;

/** Any question in the manifest, found by its unique ID. */
function findQuestionById(state: State, questionId: string): QuestionSpec | null {
  for (const room of state.manifest.rooms) {
    for (const spec of room.lockSlots) {
      if (spec.primaryQuestion.questionId === questionId) return spec.primaryQuestion;
      if (spec.alternateQuestion?.questionId === questionId) return spec.alternateQuestion;
    }
  }
  for (const spec of state.manifest.finalDoor.slots) {
    if (spec.question.questionId === questionId) return spec.question;
  }
  return null;
}

interface HintableSlot {
  readonly slotId: string;
  readonly status: string;
  readonly currentQuestionId: string;
  readonly appliedHint: AppliedHintState | null;
}

function locate(state: State, slotId: string): HintableSlot | null {
  for (const room of state.rooms) {
    const slot =
      room.lockSlots.find((s) => s.slotId === slotId) ??
      room.dueReturnSlots.find((s) => s.slotId === slotId);
    if (slot !== undefined) return slot;
  }
  return state.finalDoor.slots.find((s) => s.slotId === slotId) ?? null;
}

function withHint<T extends { readonly slotId: string }>(
  slots: readonly T[],
  slotId: string,
  hint: AppliedHintState,
): readonly T[] {
  return slots.map((s) => (s.slotId === slotId ? { ...s, appliedHint: hint } : s));
}

/**
 * Spend one hint on the question a slot shows (Req 18). The hint is recorded only on the slot,
 * bound to that question, and is never refunded. Concept records are not touched here: whether
 * an answer counts as assisted is decided when it is judged.
 */
export function handleHintUsed(state: State, event: HintUsedEvent): ApplyResult {
  const slot = locate(state, event.slotId);
  if (slot === null) return reject('unknown-reference');
  if (slot.status !== 'open') return reject('lock-already-settled');
  if (slot.appliedHint?.questionId === slot.currentQuestionId) {
    return reject('hint-already-used', { slotId: slot.slotId });
  }
  if (state.remainingHints <= 0) return reject('no-hints-left', { slotId: slot.slotId });

  const question = findQuestionById(state, slot.currentQuestionId);
  if (question === null) return reject('unknown-reference');

  const hint: AppliedHintState = {
    questionId: slot.currentQuestionId,
    effect: question.hintEffect,
  };
  const rooms = state.rooms.map((room) => ({
    ...room,
    lockSlots: withHint(room.lockSlots, slot.slotId, hint),
    dueReturnSlots: withHint(room.dueReturnSlots, slot.slotId, hint),
  }));
  return accept({
    ...state,
    rooms,
    finalDoor: { ...state.finalDoor, slots: withHint(state.finalDoor.slots, slot.slotId, hint) },
    remainingHints: state.remainingHints - 1,
  });
}
