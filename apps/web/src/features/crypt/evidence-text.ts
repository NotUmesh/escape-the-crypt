import type { FinalDoorSlotState, LockSlotState, ReturnSlotState } from '@escape-the-crypt/core';

export type EvidenceResult = 'correct' | 'wrong' | null;

/**
 * Which evidence wording a slot's panel shows. A Lock_Slot follows its judged result;
 * Return_Slots and Final_Door slots carry none, so their status decides.
 * Challenged and open slots show neither wording.
 */
export function evidenceResult(slot: LockSlotState | ReturnSlotState | FinalDoorSlotState): EvidenceResult {
  if ('judgedResult' in slot) {
    return slot.judgedResult === 'correct' || slot.judgedResult === 'wrong' ? slot.judgedResult : null;
  }
  if (slot.status === 'solved') return 'correct';
  if (slot.status === 'settled') return 'wrong';
  return null;
}
