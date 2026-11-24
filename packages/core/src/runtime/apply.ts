import type { Event, EventKind } from '../types';
import { isEvent } from './event-guard';
import { handleAnswerSubmitted, handleEvidenceContinued } from './handlers-answer';
import { handleFinalDoorEntered } from './handlers-final-door';
import { handleHintUsed } from './handlers-hint';
import { handleLockOpened, handleRoomEntered, handleRoomPublished } from './handlers-room';
import {
  handleCryptFinalised,
  handleCryptShortened,
  handleRunLeft,
  handleRunResumed,
  handleRunStarted,
} from './handlers-run';
import { handleChallenged, handleSkipped } from './handlers-skip-challenge';
import { reject } from './result';
import type { ApplyResult } from './result';
import { findRoomIndex, findSlot } from './slot-lookup';
import type { State } from './state-types';

export type { ApplyResult } from './result';

/** Events accepted before `RunStarted` (Req 2.5). */
const BEFORE_START: ReadonlySet<EventKind> = new Set<EventKind>([
  'RunStarted',
  'RoomPublished',
  'CryptFinalised',
  'CryptShortened',
]);

/** Events that are not learner actions; they pass the "left" guard (Req 3.4). */
const NOT_LEARNER: ReadonlySet<EventKind> = new Set<EventKind>([
  'RunStarted',
  'RoomPublished',
  'CryptFinalised',
  'CryptShortened',
  'RunLeft',
  'RunResumed',
]);

/** Events that target a slot and need it open (Req 3.6). EvidenceContinued does not. */
const NEEDS_OPEN_SLOT: ReadonlySet<EventKind> = new Set<EventKind>([
  'LockOpened',
  'HintUsed',
  'AnswerSubmitted',
  'Skipped',
  'Challenged',
]);

/**
 * True when the slot is playable now: a Lock_Slot or due Return_Slot of the current room,
 * or, while the Final_Door is the place being played, a Final_Door slot (Req 9.5).
 */
function slotIsInPlay(state: State, slotId: string): boolean {
  if (state.atFinalDoor) return state.finalDoor.slots.some((s) => s.slotId === slotId);
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  if (room === undefined) return false;
  return (
    room.lockSlots.some((s) => s.slotId === slotId) ||
    room.dueReturnSlots.some((s) => s.slotId === slotId)
  );
}

/** Guards shared by every event. Returns a rejection, or null when the event may proceed. */
function guard(state: State, event: Event): ApplyResult | null {
  if (state.status === 'escaped') return reject('run-finished');
  if (state.status === 'not started' && !BEFORE_START.has(event.kind)) {
    return reject('run-not-started');
  }
  if (state.status === 'left' && !NOT_LEARNER.has(event.kind)) return reject('run-left');

  switch (event.kind) {
    case 'RoomPublished':
    case 'RoomEntered':
      if (findRoomIndex(state, event.roomId) < 0) return reject('unknown-reference');
      return null;
    case 'LockOpened':
    case 'HintUsed':
    case 'AnswerSubmitted':
    case 'Skipped':
    case 'Challenged':
    case 'EvidenceContinued': {
      const slot = findSlot(state, event.slotId);
      if (slot === null) return reject('unknown-reference');
      if (NEEDS_OPEN_SLOT.has(event.kind)) {
        if (!slotIsInPlay(state, event.slotId)) return reject('lock-not-in-room');
        if (slot.status !== 'open') return reject('lock-already-settled');
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Apply one event to a state. Returns a new state and notices, or a typed rejection that
 * leaves the input state untouched. Pure; never throws and never mutates `state`.
 */
export function apply(state: State, event: Event): ApplyResult {
  const candidate: unknown = event;
  if (!isEvent(candidate)) return reject('malformed-event');

  const rejection = guard(state, candidate);
  if (rejection !== null) return rejection;

  switch (candidate.kind) {
    case 'RunStarted':
      return handleRunStarted(state, candidate);
    case 'RoomPublished':
      return handleRoomPublished(state, candidate);
    case 'CryptFinalised':
      return handleCryptFinalised(state, candidate);
    case 'CryptShortened':
      return handleCryptShortened(state, candidate);
    case 'RoomEntered':
      return handleRoomEntered(state, candidate);
    case 'LockOpened':
      return handleLockOpened(state, candidate);
    case 'AnswerSubmitted':
      return handleAnswerSubmitted(state, candidate);
    case 'EvidenceContinued':
      return handleEvidenceContinued(state, candidate);
    case 'HintUsed':
      return handleHintUsed(state, candidate);
    case 'FinalDoorEntered':
      return handleFinalDoorEntered(state);
    case 'Skipped':
      return handleSkipped(state, candidate);
    case 'Challenged':
      return handleChallenged(state, candidate);
    case 'RunLeft':
      return handleRunLeft(state);
    case 'RunResumed':
      return handleRunResumed(state);
  }
}
