import type { SlotStatus, State } from './state-types';

export interface SlotRef {
  readonly slotId: string;
  readonly status: SlotStatus;
  readonly kind: 'lock' | 'return' | 'final-door';
}

/** Find a slot by ID among Lock_Slots, Return_Slots and Final_Door slots. */
export function findSlot(state: State, slotId: string): SlotRef | null {
  for (const room of state.rooms) {
    for (const slot of room.lockSlots) {
      if (slot.slotId === slotId) return { slotId, status: slot.status, kind: 'lock' };
    }
    for (const slot of room.dueReturnSlots) {
      if (slot.slotId === slotId) return { slotId, status: slot.status, kind: 'return' };
    }
  }
  for (const slot of state.finalDoor.slots) {
    if (slot.slotId === slotId) return { slotId, status: slot.status, kind: 'final-door' };
  }
  return null;
}

export function findRoomIndex(state: State, roomId: string): number {
  return state.rooms.findIndex((room) => room.roomId === roomId);
}
