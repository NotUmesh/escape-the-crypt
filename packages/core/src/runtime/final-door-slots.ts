import { chooseReturnQuestion } from './ghost-queue';
import { escaped } from './notices';
import type { ClearingResult } from './room-clearing';
import { findSpecByConcept, returnSlotId } from './room-clearing';
import type { FinalDoorSlotState, State } from './state-types';

/** The Final_Door slot with this ID, or null. */
export function findDoorSlot(state: State, slotId: string): FinalDoorSlotState | null {
  return state.finalDoor.slots.find((s) => s.slotId === slotId) ?? null;
}

/**
 * Turn every pending ghost into an open Final_Door Return slot. GHOST_DELAY is waived at the
 * door, so every ghost is due at once (Req 20.2, 20.8). A ghost with no unchallenged question
 * is dropped and its concept marked review due (Req 14.11).
 */
export function materialiseDoorReturns(state: State): State {
  if (state.ghosts.length === 0) return state;
  let concepts = state.concepts;
  const added: FinalDoorSlotState[] = [];
  for (const ghost of state.ghosts) {
    const spec = findSpecByConcept(state, ghost.conceptId);
    const record = concepts.find((c) => c.conceptId === ghost.conceptId);
    if (spec === null || record === undefined) continue;
    const chosen = chooseReturnQuestion(spec, record, ghost.returnNumber);
    if (!chosen.ok) {
      concepts = concepts.map((c) => (c.conceptId === ghost.conceptId ? { ...c, reviewDueFlag: true } : c));
      continue;
    }
    const { choice } = chosen;
    concepts = concepts.map((c) => (c.conceptId === ghost.conceptId ? choice.record : c));
    added.push({
      slotId: returnSlotId(ghost.conceptId, ghost.returnNumber),
      origin: 'return',
      conceptId: ghost.conceptId,
      returnNumber: ghost.returnNumber,
      currentQuestionId: choice.question.questionId,
      currentQuestionType: choice.question.lockType,
      label: choice.label,
      status: 'open',
      candleLit: false,
      appliedHint: null,
      evidencePanelOpen: false,
    });
  }
  return {
    ...state,
    concepts,
    ghosts: [],
    finalDoor: { ...state.finalDoor, slots: [...state.finalDoor.slots, ...added] },
  };
}

/**
 * The one call site every Final_Door handler uses after it settles a slot: add the Return
 * slots that are due at once, then set Escaped when no slot is open (Req 20.5, 20.12). A door
 * with zero slots after entry (no reserved questions, no outstanding ghosts) escapes at once.
 * `escaped` is emitted once, because an escaped run rejects every later event.
 */
export function settleDoor(state: State): ClearingResult {
  const next = materialiseDoorReturns(state);
  if (next.finalDoor.slots.some((s) => s.status === 'open')) return { state: next, notices: [] };
  return { state: { ...next, status: 'escaped' }, notices: [escaped()] };
}
