import type { Event } from '../types';
import { findDoorSlot, materialiseDoorReturns, settleDoor } from './final-door-slots';
import { hasEligibleReturnQuestion, spawnGhost } from './ghost-queue';
import { conceptAfterReturn, findReturnQuestion } from './handlers-return-answer';
import { hasEarlierWrongOrSkip, recordSkippedConcept } from './handlers-return-settle';
import type { QuestionSpec } from './manifest-types';
import {
  FINAL_DOOR_TARGET,
  candleLitForSlot,
  candleLitForSpirit,
  ghostLaidToRest,
  ghostSpawned,
  orderNotices,
  sealCracked,
} from './notices';
import type { Outcome_Notice } from './notices';
import { accept, reject } from './result';
import type { ApplyResult } from './result';
import { findSpecByConcept } from './room-clearing';
import { runJudge } from './run-judge';
import type { ConceptRecord, FinalDoorSlotState, State } from './state-types';

type AnswerSubmittedEvent = Extract<Event, { kind: 'AnswerSubmitted' }>;

function replaceSlot(state: State, updated: FinalDoorSlotState): State {
  const slots = state.finalDoor.slots.map((s) => (s.slotId === updated.slotId ? updated : s));
  return { ...state, finalDoor: { ...state.finalDoor, slots } };
}

function updateConcept(state: State, conceptId: string, change: (c: ConceptRecord) => ConceptRecord): State {
  return { ...state, concepts: state.concepts.map((c) => (c.conceptId === conceptId ? change(c) : c)) };
}

function finish(state: State, notices: readonly Outcome_Notice[]): ApplyResult {
  const settled = settleDoor(state);
  return accept(settled.state, orderNotices([...notices, ...settled.notices]));
}

/** The question a Final_Door slot shows: a reserved manifest question or a Return question. */
function doorQuestion(state: State, slot: FinalDoorSlotState): QuestionSpec | null {
  if (slot.origin === 'return') return findReturnQuestion(state, slot);
  return state.manifest.finalDoor.slots.find((s) => s.slotId === slot.slotId)?.question ?? null;
}

/**
 * Enter the Final_Door (Req 20.2, 20.3). Every outstanding ghost and deferred skip becomes
 * due at once. Entering again is a no-op.
 */
export function handleFinalDoorEntered(state: State): ApplyResult {
  if (!state.finalDoor.available) return reject('final-door-unavailable');
  if (state.atFinalDoor) return accept(state);
  return finish(materialiseDoorReturns({ ...state, atFinalDoor: true }), []);
}

/**
 * Judge an answer at the Final_Door (Req 20.4, 20.6, 20.9, 20.10). A reserved question only
 * lights a candle or settles: no Return, no concept change. A Return follows Requirement 14,
 * with the next Return due at once.
 */
export function handleDoorAnswer(state: State, event: AnswerSubmittedEvent, slot: FinalDoorSlotState): ApplyResult {
  if (slot.status !== 'open') return reject('lock-already-settled');
  const question = doorQuestion(state, slot);
  if (question === null) return reject('unknown-reference');
  const hint = slot.appliedHint?.questionId === slot.currentQuestionId ? slot.appliedHint : null;
  const result = runJudge(slot.currentQuestionType, question.payload, event.submission, hint?.effect ?? null);
  if (result === 'invalid') return reject('invalid-submission', { slotId: slot.slotId });

  const correct = result === 'correct';
  const judgedCount = state.judgedAnswerCount + 1;
  const updatedSlot: FinalDoorSlotState = {
    ...slot,
    status: correct ? 'solved' : 'settled',
    candleLit: correct,
    evidencePanelOpen: true,
  };
  let next: State = {
    ...replaceSlot(state, updatedSlot),
    judgedAnswerCount: judgedCount,
    candleCount: state.candleCount + (correct ? 1 : 0),
  };
  const notices: Outcome_Notice[] = [];
  if (slot.origin === 'reserved' || slot.returnNumber === null) {
    if (correct) notices.push(candleLitForSlot(slot.slotId));
    return finish(next, notices);
  }

  const returnNumber = slot.returnNumber;
  next = updateConcept(next, slot.conceptId, (c) => conceptAfterReturn(c, returnNumber, result, hint !== null));
  if (correct) {
    next = {
      ...next,
      finalDoor: {
        ...next.finalDoor,
        spiritCandles: [...next.finalDoor.spiritCandles, { conceptId: slot.conceptId, returnSlotId: slot.slotId }],
      },
    };
    notices.push(candleLitForSpirit(FINAL_DOOR_TARGET), ghostLaidToRest(slot.conceptId));
  } else if (returnNumber === 1) {
    const record = next.concepts.find((c) => c.conceptId === slot.conceptId);
    const eligible =
      record !== undefined && hasEligibleReturnQuestion(findSpecByConcept(state, slot.conceptId), record, 2);
    const spawned = eligible ? spawnGhost(next.ghosts, slot.conceptId, 2, judgedCount) : null;
    if (spawned?.ok === true) {
      next = { ...next, ghosts: spawned.ghosts };
      notices.push(ghostSpawned(slot.conceptId));
    } else {
      next = updateConcept(next, slot.conceptId, (c) => ({ ...c, reviewDueFlag: true }));
    }
  }
  return finish(next, notices);
}

/** Skip a Final_Door slot (Req 16.7). A Return follows Requirement 16; a reserved one only settles. */
export function handleDoorSkip(state: State, slot: FinalDoorSlotState): ApplyResult {
  if (slot.status !== 'open') return reject('lock-already-settled');
  const settled: FinalDoorSlotState = { ...slot, status: 'settled', candleLit: false, evidencePanelOpen: false };
  const next = replaceSlot(state, settled);
  return finish(slot.origin === 'return' ? recordSkippedConcept(next, slot.conceptId) : next, []);
}

/** Challenge a Final_Door slot (Req 17.4, 17.5, 17.7). There is no Alternate at the door. */
export function handleDoorChallenge(state: State, slot: FinalDoorSlotState): ApplyResult {
  if (slot.status !== 'open') return reject('lock-already-settled');
  const closed: FinalDoorSlotState = { ...slot, status: 'challenged', candleLit: false, evidencePanelOpen: false };
  let next = replaceSlot(state, closed);
  const returnNumber = slot.returnNumber;
  if (slot.origin === 'return' && returnNumber !== null) {
    next = updateConcept(next, slot.conceptId, (c) => {
      const earlier = hasEarlierWrongOrSkip(c, returnNumber);
      const marked: ConceptRecord =
        returnNumber === 1 ? { ...c, return1Result: 'challenged' } : { ...c, return2Result: 'challenged' };
      return earlier ? { ...marked, reviewDueFlag: true } : marked;
    });
  }
  return finish(next, [sealCracked(slot.slotId)]);
}

/** Close the evidence panel of a Final_Door slot (Req 10.5). */
export function handleDoorEvidenceContinued(state: State, slotId: string): ApplyResult | null {
  const slot = findDoorSlot(state, slotId);
  if (slot === null) return null;
  if (!slot.evidencePanelOpen) return reject('no-evidence-open', { slotId });
  return accept(replaceSlot(state, { ...slot, evidencePanelOpen: false }));
}
