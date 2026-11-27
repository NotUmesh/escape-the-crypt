import {
  FINAL_DOOR_BUTTON_TEXT,
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

const SEAL_STATUS_WORDS: Readonly<Record<SlotStatus, string>> = {
  open: 'not yet answered',
  solved: 'solved',
  settled: 'excluded from score',
  challenged: 'challenged, excluded from score',
};

/** A seal on the final door, numbered from 1 in slot order (Requirement 21.6). */
export function sealName(sealNumber: number, status: SlotStatus): string {
  return `Seal ${sealNumber}, ${SEAL_STATUS_WORDS[status]}`;
}

const PLACE_NAMES: readonly string[] = ['ones', 'tens', 'hundreds', 'thousands', 'ten-thousands', 'hundred-thousands'];
/** The place a dial wheel stands for: exponent 0 is ones, -1 is tenths. */
export function placeName(exponent: number): string {
  if (exponent === -1) return 'tenths';
  return PLACE_NAMES[exponent] ?? `place ${exponent + 1}`;
}
/** "Increase tens wheel, now 4" and its siblings. */
export function wheelName(action: 'wheel' | 'increase' | 'decrease', exponent: number, digit: number): string {
  const place = placeName(exponent);
  const verb = action === 'increase' ? 'Increase' : action === 'decrease' ? 'Decrease' : null;
  return verb === null ? `${place} wheel` : `${verb} ${place} wheel, now ${digit}`;
}
/** "Move up: The aorta, position 2 of 4". */
export function boneMoveName(action: 'up' | 'down', text: string, position: number, total: number): string {
  return `${action === 'up' ? 'Move up' : 'Move down'}: ${text}, position ${position} of ${total}`;
}
/** "The aorta, tied to The heart" / "The aorta, selected" / "The aorta, not tied". */
export function threadStateName(text: string, state: 'tied' | 'selected' | 'untied', partnerText?: string): string {
  if (state === 'tied') return `${text}, tied to ${partnerText ?? 'a partner'}`;
  return state === 'selected' ? `${text}, selected` : `${text}, not tied`;
}
