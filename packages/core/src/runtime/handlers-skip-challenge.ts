import type { Event } from '../types';
import type { LockSlotSpec } from './manifest-types';
import { findReturnSlot } from './handlers-return-answer';
import { challengeReturnSlot, recordSkippedConcept, skipReturnSlot } from './handlers-return-settle';
import { orderNotices, sealCracked } from './notices';
import type { Outcome_Notice } from './notices';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import { settleRoom } from './room-clearing';
import type { ConceptRecord, LockSlotState, State } from './state-types';

type SkippedEvent = Extract<Event, { kind: 'Skipped' }>;
type ChallengedEvent = Extract<Event, { kind: 'Challenged' }>;

interface Located {
  readonly roomIndex: number;
  readonly slot: LockSlotState;
  readonly spec: LockSlotSpec;
}

/**
 * Find a Lock_Slot and its manifest spec. Return_Slots are handled in handlers-return-settle.ts;
 * Final_Door slots arrive in 6.3.
 */
function locate(state: State, slotId: string): Located | null {
  for (let roomIndex = 0; roomIndex < state.rooms.length; roomIndex += 1) {
    const slot = state.rooms[roomIndex]?.lockSlots.find((s) => s.slotId === slotId);
    if (slot === undefined) continue;
    const spec = state.manifest.rooms
      .flatMap((r) => r.lockSlots)
      .find((s) => s.slotId === slotId);
    if (spec === undefined) return null;
    return { roomIndex, slot, spec };
  }
  return null;
}

function replaceSlot(state: State, roomIndex: number, updated: LockSlotState): State {
  const rooms = state.rooms.map((room, i) =>
    i === roomIndex
      ? { ...room, lockSlots: room.lockSlots.map((s) => (s.slotId === updated.slotId ? updated : s)) }
      : room,
  );
  return { ...state, rooms };
}

function updateConcept(
  state: State,
  conceptId: string,
  change: (c: ConceptRecord) => ConceptRecord,
): State {
  return {
    ...state,
    concepts: state.concepts.map((c) => (c.conceptId === conceptId ? change(c) : c)),
  };
}

/** Run the Cleared check for the room and order the notices of this event. */
function finish(state: State, roomIndex: number, notices: readonly Outcome_Notice[]): ApplyResult {
  const room = state.rooms[roomIndex];
  const cleared = room === undefined ? { state, notices: [] } : settleRoom(state, room.roomId);
  return accept(cleared.state, orderNotices([...notices, ...cleared.notices]));
}

/**
 * Skip a Lock_Slot (Req 16.1, 16.2): the slot is settled with no candle, no ghost and no
 * judged answer. With an unused Alternate a deferred return 1 is queued; otherwise the
 * Review_Due_Flag is set (Req 16.3, 16.4).
 */
export function handleSkipped(state: State, event: SkippedEvent): ApplyResult {
  const located = locate(state, event.slotId);
  if (located === null) {
    const ret = findReturnSlot(state, event.slotId);
    if (ret === null) return reject('unknown-reference');
    if (ret.slot.status !== 'open') return reject('lock-already-settled');
    return skipReturnSlot(state, ret);
  }
  const { roomIndex, slot, spec } = located;
  if (slot.status !== 'open') return reject('lock-already-settled');

  const settled: LockSlotState = {
    ...slot,
    status: 'settled',
    candleLit: false,
    evidencePanelOpen: false,
  };
  const next = recordSkippedConcept(replaceSlot(state, roomIndex, settled), spec.conceptId);
  return finish(next, roomIndex, []);
}

/**
 * Challenge the question a Lock_Slot shows (Req 17). With an unused Alternate the question is
 * replaced in place and the slot stays open; otherwise the slot becomes `challenged`. A
 * challenge never lights a candle, spawns a ghost or counts as a judged answer.
 */
export function handleChallenged(state: State, event: ChallengedEvent): ApplyResult {
  const located = locate(state, event.slotId);
  if (located === null) {
    const ret = findReturnSlot(state, event.slotId);
    if (ret === null) return reject('unknown-reference');
    if (ret.slot.status !== 'open') return reject('lock-already-settled');
    return challengeReturnSlot(state, ret);
  }
  const { roomIndex, slot, spec } = located;
  if (slot.status !== 'open') return reject('lock-already-settled');

  const onPrimary = slot.currentQuestionId === spec.primaryQuestion.questionId;
  const concept = state.concepts.find((c) => c.conceptId === spec.conceptId);
  const alternate = spec.alternateQuestion;
  let next: State;
  if (onPrimary && alternate !== null && concept?.alternateUsed !== true) {
    const replaced: LockSlotState = {
      ...slot,
      currentQuestionId: alternate.questionId,
      currentQuestionType: alternate.lockType,
      status: 'open',
      appliedHint: null,
      evidencePanelOpen: false,
      judgedResult: null,
    };
    next = updateConcept(replaceSlot(state, roomIndex, replaced), spec.conceptId, (c) => ({
      ...c,
      firstQuestionResult: 'challenged',
      alternateUsed: true,
      shownQuestionIds: c.shownQuestionIds.includes(alternate.questionId)
        ? c.shownQuestionIds
        : [...c.shownQuestionIds, alternate.questionId],
    }));
  } else {
    const closed: LockSlotState = {
      ...slot,
      status: 'challenged',
      candleLit: false,
      evidencePanelOpen: false,
    };
    next = updateConcept(replaceSlot(state, roomIndex, closed), spec.conceptId, (c) =>
      onPrimary
        ? { ...c, firstQuestionResult: 'challenged' }
        : { ...c, alternateChallenged: true, alternateResult: 'challenged' },
    );
  }
  return finish(next, roomIndex, [sealCracked(slot.slotId)]);
}
