import fc from 'fast-check';
import { apply, initial } from '@escape-the-crypt/core';
import type { CryptManifest, Event, RunSettings, State } from '@escape-the-crypt/core';
import { manifestArb } from '../../../../../packages/core/src/test-support/arbitraries';
import { submissionFor } from '../../../../../packages/core/src/test-support/question-answers';
import { openTargets, questionFor } from '../../../../../packages/core/src/test-support/runtime-model-support';

/** Persistence-only arbitraries. Shared arbitraries stay in core's test-support. */

export const runSettingsArb: fc.Arbitrary<RunSettings> = fc.record({
  length: fc.constantFrom('short', 'standard', 'long'),
  difficulty: fc.constantFrom('apprentice', 'gravedigger', 'lich'),
  hintAllowance: fc.integer({ min: 0, max: 3 }),
}) as fc.Arbitrary<RunSettings>;

export interface AcceptedRun {
  readonly manifest: CryptManifest;
  readonly settings: RunSettings;
  /** Every event here was accepted by the real `apply`, in order. */
  readonly events: readonly Event[];
  /** The state the reducer reached after the last event. */
  readonly state: State;
}

/** The fixed start sequence the binding writes for a new run. */
export function startEventsFor(manifest: CryptManifest): readonly Event[] {
  const firstRoom = manifest.rooms[0]?.roomId ?? '';
  return [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: firstRoom },
    { kind: 'CryptFinalised', finalRoomCount: manifest.rooms.length },
    { kind: 'RoomEntered', roomId: firstRoom },
  ];
}

function tryApply(state: State, event: Event): State | null {
  const result = apply(state, event);
  return result.ok ? result.state : null;
}

/** One reducer-legal move chosen from `choice`, or null when no learner move is available. */
function nextEvent(state: State, choice: number): Event | null {
  if (state.status === 'escaped') return null;
  const manifest = state.manifest;
  const open = state.atFinalDoor
    ? state.finalDoor.slots.find((s) => s.status === 'open')
    : openTargets(state)[0];
  if (open !== undefined) {
    const slotId = open.slotId;
    const questionId = 'currentQuestionId' in open ? open.currentQuestionId : open.questionId;
    switch (choice % 5) {
      case 0:
        return { kind: 'AnswerSubmitted', slotId, submission: submissionFor(questionFor(manifest, questionId), true) };
      case 1:
        return { kind: 'AnswerSubmitted', slotId, submission: submissionFor(questionFor(manifest, questionId), false) };
      case 2:
        return { kind: 'Skipped', slotId };
      case 3:
        return { kind: 'Challenged', slotId };
      default:
        return { kind: 'HintUsed', slotId };
    }
  }
  if (state.atFinalDoor) return null;
  if (state.finalDoor.available) return { kind: 'FinalDoorEntered' };
  const index = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
  const next = manifest.rooms[index + 1];
  if (next === undefined) return null;
  return { kind: 'RoomEntered', roomId: next.roomId };
}

/**
 * Builds a run by stepping the real reducer. A move the reducer rejects is dropped, so every event
 * in the result is accepted by `apply` at its position.
 */
export function playAccepted(
  manifest: CryptManifest,
  settings: RunSettings,
  choices: readonly number[],
): AcceptedRun {
  let state = initial(manifest, settings);
  const events: Event[] = [];
  const push = (event: Event): boolean => {
    const next = tryApply(state, event);
    if (next === null) return false;
    state = next;
    events.push(event);
    return true;
  };
  for (const event of startEventsFor(manifest)) push(event);
  for (const choice of choices) {
    let event = nextEvent(state, choice);
    if (event === null) break;
    // Moving to a later room needs it published first.
    if (event.kind === 'RoomEntered') {
      const roomId = event.roomId;
      if (state.rooms.find((r) => r.roomId === roomId)?.published !== true) {
        push({ kind: 'RoomPublished', roomId });
      }
      event = { kind: 'RoomEntered', roomId };
    }
    push(event);
  }
  return { manifest, settings, events, state };
}

/** Runs with 0..maxMoves learner moves after the start sequence. */
export function acceptedRunArb(maxMoves = 40): fc.Arbitrary<AcceptedRun> {
  return fc
    .tuple(manifestArb, runSettingsArb, fc.array(fc.nat({ max: 1000 }), { maxLength: maxMoves }))
    .map(([manifest, settings, choices]) => playAccepted(manifest, settings, choices));
}

export type FailureKind =
  | 'undefined-factory'
  | 'rejected-open'
  | 'aborted-transaction'
  | 'quota-exceeded';

/** Fail the append at index `atIndex` of the accepted events; `retryAfter` says whether a retry works. */
export interface FailurePlan {
  readonly kind: FailureKind;
  readonly atIndex: number;
  readonly retryAfter: boolean;
}

export function failurePlanArb(eventCount: number): fc.Arbitrary<FailurePlan> {
  return fc.record({
    kind: fc.constantFrom<FailureKind>('undefined-factory', 'rejected-open', 'aborted-transaction', 'quota-exceeded'),
    atIndex: fc.integer({ min: 0, max: Math.max(0, eventCount - 1) }),
    retryAfter: fc.boolean(),
  });
}
