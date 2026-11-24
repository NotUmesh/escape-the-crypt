import type { Event } from '../types';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import { findRoomIndex } from './slot-lookup';
import type { State } from './state-types';

type RoomPublishedEvent = Extract<Event, { kind: 'RoomPublished' }>;
type RoomEnteredEvent = Extract<Event, { kind: 'RoomEntered' }>;
type LockOpenedEvent = Extract<Event, { kind: 'LockOpened' }>;

/** Mark a room published. A duplicate is a successful no-op (Req 7.1, 7.2). */
export function handleRoomPublished(state: State, event: RoomPublishedEvent): ApplyResult {
  const index = findRoomIndex(state, event.roomId);
  const room = state.rooms[index];
  if (room === undefined) return reject('unknown-reference');
  if (room.published) return accept(state);
  const rooms = state.rooms.map((r, i) => (i === index ? { ...r, published: true } : r));
  return accept({ ...state, rooms });
}

/**
 * Enter a room. Only the first room is handled here; rooms after it are refused with
 * `room-out-of-order` until the progression checks arrive (task 6.1).
 */
export function handleRoomEntered(state: State, event: RoomEnteredEvent): ApplyResult {
  const index = findRoomIndex(state, event.roomId);
  const room = state.rooms[index];
  if (room === undefined) return reject('unknown-reference');
  if (!room.published) return reject('room-not-published');
  if (index !== 0) return reject('room-out-of-order');
  return accept({ ...state, currentRoomId: room.roomId });
}

/** Record the focused lock. `apply.ts` has already checked the room (Req 9.1, 9.2, 9.5). */
export function handleLockOpened(state: State, event: LockOpenedEvent): ApplyResult {
  return accept({ ...state, focusedSlotId: event.slotId });
}
