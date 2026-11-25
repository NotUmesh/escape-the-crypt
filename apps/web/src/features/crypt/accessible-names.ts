import {
  FINAL_DOOR_BUTTON_TEXT,
  FINAL_DOOR_STATUS_LABELS,
  LOCK_OBJECT_NAMES,
  ROOM_PLAY_LABELS,
  SLOT_STATUS_WORDS,
} from '@escape-the-crypt/core';
import type { LockType, SlotStatus } from '@escape-the-crypt/core';

/** "Rune tablet: rune cipher, unsolved" (Requirements 10.3, 21.6). */
export function lockName(lockType: LockType, status: SlotStatus): string {
  const { object, kind } = LOCK_OBJECT_NAMES[lockType];
  return `${object}: ${kind}, ${SLOT_STATUS_WORDS[status]}`;
}

/** A pending ghost, named by its return number (Requirements 18.3, 21.6). */
export function ghostName(returnNumber: number): string {
  return ROOM_PLAY_LABELS.ghostName(returnNumber);
}

/** A Return_Slot control: states it is a returning question, plus its status (Requirements 18.7, 21.6). */
export function returnSlotName(isReview: boolean, status: SlotStatus): string {
  return `${ROOM_PLAY_LABELS.returnSlotName(isReview)}, ${SLOT_STATUS_WORDS[status]}`;
}

/** The button that opens the final door (Requirement 19.2). */
export function doorButtonName(): string {
  return FINAL_DOOR_BUTTON_TEXT;
}

/** A seal on the final door, numbered from 1 in slot order (Requirement 21.6). */
export function sealName(sealNumber: number, status: SlotStatus): string {
  return `Seal ${sealNumber}: ${FINAL_DOOR_STATUS_LABELS[status].toLowerCase()}`;
}
