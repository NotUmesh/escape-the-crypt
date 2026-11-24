import type { Event, EventKind } from '../types';
import { isEvent } from './event-guard';
import { handleRunStarted } from './handlers-run';
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
      if (NEEDS_OPEN_SLOT.has(event.kind) && slot.status !== 'open') {
        return reject('lock-already-settled');
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
    default:
      // Handlers for the other kinds are wired in later tasks. Until then the event is
      // refused rather than silently accepted, and State stays unchanged.
      return reject('malformed-event', { reason: 'handler-not-wired', eventKind: candidate.kind });
  }
}
