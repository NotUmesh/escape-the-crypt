import type { State } from '@escape-the-crypt/core';

export type ArtRoom = 'burial-chamber' | 'library-of-bones' | 'sunken-chapel';

const ART_ROOMS: readonly ArtRoom[] = ['burial-chamber', 'library-of-bones', 'sunken-chapel'];

/** The art room for a 1-based room position. Positions outside 1..3 have no art. */
export function artRoomForPosition(position: number): ArtRoom | null {
  if (!Number.isInteger(position)) return null;
  return ART_ROOMS[position - 1] ?? null;
}

/**
 * The 1-based position of the current room in `State.rooms`, or null when the
 * current room is not in the list. Only list order is used, never the room's id text.
 */
export function currentRoomPosition(state: Pick<State, 'rooms' | 'currentRoomId'>): number | null {
  const index = state.rooms.findIndex((room) => room.roomId === state.currentRoomId);
  return index < 0 ? null : index + 1;
}

export function artRoomForState(state: Pick<State, 'rooms' | 'currentRoomId'>): ArtRoom | null {
  const position = currentRoomPosition(state);
  return position === null ? null : artRoomForPosition(position);
}
