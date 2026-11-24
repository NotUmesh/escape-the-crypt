import { chooseReturnQuestion, partitionGhosts } from './ghost-queue';
import type { LockSlotSpec } from './manifest-types';
import { roomCleared } from './notices';
import type { Outcome_Notice } from './notices';
import type { FinalDoorSlotState, ReturnSlotState, RoomState, SlotStatus, State } from './state-types';

function isDone(status: SlotStatus): boolean {
  return status !== 'open';
}

/**
 * The Cleared check (Req 19.1, 19.2): a published room is Cleared when every Lock_Slot
 * and every due Return_Slot is solved or settled. Correctness plays no part.
 */
export function isRoomCleared(room: RoomState): boolean {
  if (!room.published) return false;
  return room.lockSlots.every((s) => isDone(s.status)) && room.dueReturnSlots.every((s) => isDone(s.status));
}

export interface ClearingResult {
  readonly state: State;
  readonly notices: readonly Outcome_Notice[];
}

/** The Return_Slot ID for a concept's n-th return. Unique because a concept returns at most twice. */
export function returnSlotId(conceptId: string, returnNumber: 1 | 2): string {
  return `return-${conceptId}-${returnNumber}`;
}

export function findSpecByConcept(state: State, conceptId: string): LockSlotSpec | null {
  for (const room of state.manifest.rooms) {
    const spec = room.lockSlots.find((s) => s.conceptId === conceptId);
    if (spec !== undefined) return spec;
  }
  return null;
}

/**
 * Turn every ghost that is now due into an open Return_Slot of the given room (Req 30.1).
 * Lock_Slots and their Station_Types are not touched (Req 30.2). Ghosts not yet due stay in
 * the queue and carry on to later rooms (Req 15.5). Only judged answers move the count, so a
 * handler that adds none leaves the queue as it was.
 */
export function materialiseDueReturns(state: State, roomId: string): State {
  const roomIndex = state.rooms.findIndex((r) => r.roomId === roomId);
  const room = state.rooms[roomIndex];
  if (room === undefined || state.ghosts.length === 0) return state;
  const { due, pending } = partitionGhosts(state.ghosts, state.judgedAnswerCount);
  if (due.length === 0) return state;

  let concepts = state.concepts;
  const added: ReturnSlotState[] = [];
  const stillPending = [...pending];
  for (const ghost of due) {
    const spec = findSpecByConcept(state, ghost.conceptId);
    const record = concepts.find((c) => c.conceptId === ghost.conceptId);
    if (spec === null || record === undefined) {
      stillPending.push({ ...ghost, due: false });
      continue;
    }
    const chosen = chooseReturnQuestion(spec, record, ghost.returnNumber);
    if (!chosen.ok) {
      // Nothing unchallenged to show: drop the ghost and mark the concept review due.
      concepts = concepts.map((c) => (c.conceptId === ghost.conceptId ? { ...c, reviewDueFlag: true } : c));
      continue;
    }
    const choice = chosen.choice;
    concepts = concepts.map((c) => (c.conceptId === ghost.conceptId ? choice.record : c));
    added.push({
      slotId: returnSlotId(ghost.conceptId, ghost.returnNumber),
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
  const rooms = state.rooms.map((r, i) =>
    i === roomIndex ? { ...r, dueReturnSlots: [...r.dueReturnSlots, ...added] } : r,
  );
  return { ...state, rooms, concepts, ghosts: stillPending };
}

/**
 * Mark the room Cleared when it qualifies. Only `cleared` changes; Lock_Slots stay
 * as they are (Req 19.3). A room already Cleared stays so and emits no second
 * `roomCleared` (Req 24.7). Prefer `settleRoom`, which adds due Return_Slots first.
 */
export function updateRoomCleared(state: State, roomId: string): ClearingResult {
  const index = state.rooms.findIndex((r) => r.roomId === roomId);
  const room = state.rooms[index];
  if (room === undefined || room.cleared || !isRoomCleared(room)) {
    return { state, notices: [] };
  }
  const rooms = state.rooms.map((r, i) => (i === index ? { ...r, cleared: true } : r));
  return { state: refreshFinalDoor({ ...state, rooms }), notices: [roomCleared(roomId)] };
}

/**
 * Make the Final_Door available once the final room count is known and every room up to
 * that count is Cleared (Req 7.7). Once available it stays available.
 */
export function refreshFinalDoor(state: State): State {
  const count = state.finalRoomCount;
  if (state.finalDoor.available || count === null || count < 1) return state;
  const upTo = state.rooms.slice(0, count);
  if (upTo.length < count || !upTo.every((r) => r.cleared)) return state;
  const reserved: FinalDoorSlotState[] = state.manifest.finalDoor.slots.map((spec) => ({
    slotId: spec.slotId,
    origin: 'reserved',
    conceptId: spec.conceptId,
    returnNumber: null,
    currentQuestionId: spec.question.questionId,
    currentQuestionType: spec.question.lockType,
    label: null,
    status: 'open',
    candleLit: false,
    appliedHint: null,
    evidencePanelOpen: false,
  }));
  // The reserved slots exist from now on but are not in play until `FinalDoorEntered`.
  return { ...state, finalDoor: { ...state.finalDoor, available: true, slots: reserved } };
}

/**
 * The one call site every handler uses after it settles a slot: add the Return_Slots that
 * are due, then decide whether the room is Cleared (Req 30.5). A room already Cleared gets no
 * new Return_Slot.
 */
export function settleRoom(state: State, roomId: string): ClearingResult {
  const room = state.rooms.find((r) => r.roomId === roomId);
  const withReturns = room !== undefined && !room.cleared ? materialiseDueReturns(state, roomId) : state;
  return updateRoomCleared(withReturns, roomId);
}
