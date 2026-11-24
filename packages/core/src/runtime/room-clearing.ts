import { roomCleared } from './notices';
import type { Outcome_Notice } from './notices';
import type { RoomState, SlotStatus, State } from './state-types';

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

/**
 * Mark the room Cleared when it qualifies. Only `cleared` changes; Lock_Slots stay
 * as they are (Req 19.3). A room already Cleared stays so and emits no second
 * `roomCleared` (Req 24.7). Callers add due Return_Slots before calling this (Req 30.5).
 */
export function updateRoomCleared(state: State, roomId: string): ClearingResult {
  const index = state.rooms.findIndex((r) => r.roomId === roomId);
  const room = state.rooms[index];
  if (room === undefined || room.cleared || !isRoomCleared(room)) {
    return { state, notices: [] };
  }
  const rooms = state.rooms.map((r, i) => (i === index ? { ...r, cleared: true } : r));
  return { state: { ...state, rooms }, notices: [roomCleared(roomId)] };
}
