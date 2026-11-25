/**
 * The UI-facing vocabulary the Room_Binding accepts. Deliberately smaller than the runtime `Event`.
 * `startRun` and `playAgain` expand to the fixed start sequence in `room-binding.ts`; every other
 * action maps to exactly one runtime Event (see `room-event-mapper.ts`).
 */
export type RoomAction =
  | { readonly type: 'startRun' }
  // Not used by any Room_Screen control while the sample crypt has one room; kept for multi-room crypts.
  | { readonly type: 'enterRoom'; readonly roomId: string }
  | { readonly type: 'openLock'; readonly slotId: string }
  | { readonly type: 'useHint'; readonly slotId: string }
  | { readonly type: 'submitAnswer'; readonly slotId: string; readonly submission: unknown }
  | { readonly type: 'skip'; readonly slotId: string }
  | { readonly type: 'challenge'; readonly slotId: string }
  | { readonly type: 'continueEvidence'; readonly slotId: string }
  | { readonly type: 'enterFinalDoor' }
  | { readonly type: 'playAgain' };

/** Actions that map to a single runtime Event. */
export type EventRoomAction = Exclude<RoomAction, { readonly type: 'startRun' | 'playAgain' }>;
