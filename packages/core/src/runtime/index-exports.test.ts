import { describe, expect, it } from 'vitest';
import type { FinalDoorSlotState, LockSlotState, ReturnSlotState } from './index';
import type { State } from './state-types';

// Type-level test: `pnpm typecheck` fails if the runtime index stops exporting a slot type.
// Validates: Requirements 4.11
type DoorSlot = State['finalDoor']['slots'][number];

function asFinalDoorSlot(slot: DoorSlot): FinalDoorSlotState {
  return slot;
}

type SlotUnion = LockSlotState | ReturnSlotState | FinalDoorSlotState;

describe('runtime index slot type exports', () => {
  it('exports the three slot types and a Final_Door slot is a FinalDoorSlotState', () => {
    const accepts = (slot: SlotUnion): string => slot.slotId;
    expect(typeof asFinalDoorSlot).toBe('function');
    expect(typeof accepts).toBe('function');
  });
});
