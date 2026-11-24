import type { CryptManifest, LockSlotSpec, RunSettings } from './manifest-types';
import type { ConceptRecord, LockSlotState, RoomState, State } from './state-types';

function lockSlotState(spec: LockSlotSpec): LockSlotState {
  return {
    slotId: spec.slotId,
    stationType: spec.stationType,
    currentQuestionId: spec.primaryQuestion.questionId,
    currentQuestionType: spec.primaryQuestion.lockType,
    status: 'open',
    candleLit: false,
    appliedHint: null,
    evidencePanelOpen: false,
    judgedResult: null,
  };
}

function conceptRecord(conceptId: string): ConceptRecord {
  return {
    conceptId,
    shownQuestionIds: [],
    firstQuestionResult: null,
    hintUsedOnCorrectQuestion: false,
    alternateUsed: false,
    alternateChallenged: false,
    alternateResult: null,
    return1Result: null,
    return2Result: null,
    wasSkippedWithNoAlternate: false,
    isLingeringSpirit: false,
    reviewDueFlag: false,
  };
}

/**
 * The state before `RunStarted`: status "not started", zero candles, no ghosts, no room
 * entered. Pure. It does not run the Manifest_Check; `RunStarted` does (Req 2.6, 2.7).
 */
export function initial(manifest: CryptManifest, settings: RunSettings): State {
  const rooms: RoomState[] = manifest.rooms.map((room) => ({
    roomId: room.roomId,
    published: false,
    cleared: false,
    lockSlots: room.lockSlots.map(lockSlotState),
    dueReturnSlots: [],
    spiritCandles: [],
  }));
  const conceptIds = [
    ...new Set(manifest.rooms.flatMap((room) => room.lockSlots.map((slot) => slot.conceptId))),
  ];
  return {
    manifestId: manifest.manifestId,
    manifest,
    status: 'not started',
    settings,
    remainingHints: 0,
    candleCount: 0,
    judgedAnswerCount: 0,
    rooms,
    currentRoomId: null,
    finalRoomCount: null,
    finalDoor: { available: false, slots: [], spiritCandles: [] },
    atFinalDoor: false,
    ghosts: [],
    concepts: conceptIds.map(conceptRecord),
    focusedSlotId: null,
  };
}
