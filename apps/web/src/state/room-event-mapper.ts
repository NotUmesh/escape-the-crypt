import type { Event } from '@escape-the-crypt/core';
import type { EventRoomAction } from './room-actions';

/** Pure: one UI action becomes exactly one runtime Event. No rules are decided here. */
export function actionToEvent(action: EventRoomAction): Event {
  switch (action.type) {
    case 'enterRoom':
      return { kind: 'RoomEntered', roomId: action.roomId };
    case 'openLock':
      return { kind: 'LockOpened', slotId: action.slotId };
    case 'useHint':
      return { kind: 'HintUsed', slotId: action.slotId };
    case 'submitAnswer':
      return { kind: 'AnswerSubmitted', slotId: action.slotId, submission: action.submission };
    case 'skip':
      return { kind: 'Skipped', slotId: action.slotId };
    case 'challenge':
      return { kind: 'Challenged', slotId: action.slotId };
    case 'continueEvidence':
      return { kind: 'EvidenceContinued', slotId: action.slotId };
    case 'enterFinalDoor':
      return { kind: 'FinalDoorEntered' };
  }
}
