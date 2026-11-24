import { hasEligibleReturnQuestion, spawnGhost } from './ghost-queue';
import type { ReturnSlotLocation } from './handlers-return-answer';
import { orderNotices, sealCracked } from './notices';
import type { Outcome_Notice } from './notices';
import { accept } from './result';
import type { ApplyResult } from './result';
import { findSpecByConcept, settleRoom } from './room-clearing';
import type { ConceptRecord, ReturnSlotState, State } from './state-types';

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

/**
 * Record that a Lock_Slot or Return_Slot of a concept was skipped (Req 16.3, 16.4).
 * With an unused Alternate a deferred return 1 joins the ghost queue under the usual due
 * rule. Otherwise the Review_Due_Flag is set and nothing is queued.
 */
export function recordSkippedConcept(state: State, conceptId: string): State {
  const spec = findSpecByConcept(state, conceptId);
  const record = state.concepts.find((c) => c.conceptId === conceptId);
  if (record === undefined) return state;
  const unusedAlternate = spec !== null && spec.alternateQuestion !== null && !record.alternateUsed;
  if (unusedAlternate && hasEligibleReturnQuestion(spec, record, 1)) {
    const spawned = spawnGhost(state.ghosts, conceptId, 1, state.judgedAnswerCount);
    if (spawned.ok) return { ...state, ghosts: spawned.ghosts };
  }
  return updateConcept(state, conceptId, (c) => ({
    ...c,
    wasSkippedWithNoAlternate: true,
    reviewDueFlag: true,
  }));
}

function replaceReturnSlot(state: State, located: ReturnSlotLocation, updated: ReturnSlotState): State {
  const rooms = state.rooms.map((room, i) =>
    i === located.roomIndex
      ? {
          ...room,
          dueReturnSlots: room.dueReturnSlots.map((s) => (s.slotId === updated.slotId ? updated : s)),
        }
      : room,
  );
  return { ...state, rooms };
}

function finish(state: State, located: ReturnSlotLocation, notices: readonly Outcome_Notice[]): ApplyResult {
  const room = state.rooms[located.roomIndex];
  const cleared = room === undefined ? { state, notices: [] } : settleRoom(state, room.roomId);
  return accept(cleared.state, orderNotices([...notices, ...cleared.notices]));
}

/** Skip an open Return_Slot (Req 16.1, 16.2, 16.3, 16.4). The caller has checked it is open. */
export function skipReturnSlot(state: State, located: ReturnSlotLocation): ApplyResult {
  const settled: ReturnSlotState = {
    ...located.slot,
    status: 'settled',
    candleLit: false,
    evidencePanelOpen: false,
  };
  const next = recordSkippedConcept(replaceReturnSlot(state, located, settled), located.slot.conceptId);
  return finish(next, located, []);
}

/**
 * True when the concept has an earlier unchallenged wrong answer or skip (Req 17.4). A first
 * result of null means the concept's first question was skipped, since a Return exists only
 * after a wrong answer or a skip.
 */
export function hasEarlierWrongOrSkip(record: ConceptRecord, returnNumber: 1 | 2): boolean {
  return (
    record.firstQuestionResult === null ||
    record.firstQuestionResult === 'wrong' ||
    record.alternateResult === 'wrong' ||
    record.wasSkippedWithNoAlternate ||
    (returnNumber === 2 && record.return1Result === 'wrong')
  );
}

/**
 * Challenge the question of an open Return_Slot (Req 17.4, 17.5, 17.7). The slot is
 * `challenged` with no further question, no candle, no ghost and no judged answer. When an
 * earlier unchallenged wrong answer or skip exists, the Review_Due_Flag records it so the
 * outcome is Review due.
 */
export function challengeReturnSlot(
  state: State,
  located: ReturnSlotLocation,
): ApplyResult {
  const { slot } = located;
  const closed: ReturnSlotState = {
    ...slot,
    status: 'challenged',
    candleLit: false,
    evidencePanelOpen: false,
  };
  const next = updateConcept(replaceReturnSlot(state, located, closed), slot.conceptId, (c) => {
    const earlier = hasEarlierWrongOrSkip(c, slot.returnNumber);
    const marked: ConceptRecord =
      slot.returnNumber === 1 ? { ...c, return1Result: 'challenged' } : { ...c, return2Result: 'challenged' };
    return earlier ? { ...marked, reviewDueFlag: true } : marked;
  });
  return finish(next, located, [sealCracked(slot.slotId)]);
}
