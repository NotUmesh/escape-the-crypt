import { ROOM_ANNOUNCEMENT_COPY } from '@escape-the-crypt/core';
import type { FinalDoorSlotState, LockSlotState, Outcome_Notice, ReturnSlotState, State } from '@escape-the-crypt/core';

import { evidenceResult } from './evidence-text';

type AnySlot = LockSlotState | ReturnSlotState | FinalDoorSlotState;
type NewStatus = keyof typeof ROOM_ANNOUNCEMENT_COPY.status;

/** Every Lock_Slot, due Return_Slot and Final_Door slot of a State, in a fixed order. */
function allSlots(state: State): readonly AnySlot[] {
  return [
    ...state.rooms.flatMap((room) => [...room.lockSlots, ...room.dueReturnSlots]),
    ...state.finalDoor.slots,
  ];
}

function isNewStatus(status: AnySlot['status']): status is NewStatus {
  return status === 'solved' || status === 'settled' || status === 'challenged';
}

/**
 * The live-region messages for one accepted dispatch, in this order: evidence result,
 * new slot status, then one message per notice in notice order. A rejected dispatch
 * (same State, no notices) gives none.
 */
export function announcementsFor(
  previous: State,
  next: State,
  notices: readonly Outcome_Notice[],
): readonly string[] {
  const before = new Map(allSlots(previous).map((slot) => [slot.slotId, slot]));
  const after = allSlots(next);
  const evidence: string[] = [];
  const status: string[] = [];

  for (const slot of after) {
    const old = before.get(slot.slotId);
    if (slot.evidencePanelOpen && !(old?.evidencePanelOpen ?? false)) {
      const result = evidenceResult(slot);
      if (result !== null) evidence.push(ROOM_ANNOUNCEMENT_COPY.evidence[result]);
    }
    if (old !== undefined && old.status === 'open' && isNewStatus(slot.status)) {
      status.push(ROOM_ANNOUNCEMENT_COPY.status[slot.status]);
    }
  }

  return [...evidence, ...status, ...notices.map((notice) => ROOM_ANNOUNCEMENT_COPY.notice[notice.kind])];
}
