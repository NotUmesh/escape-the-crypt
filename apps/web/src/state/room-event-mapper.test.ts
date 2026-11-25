import { describe, expect, it } from 'vitest';
import type { Event } from '@escape-the-crypt/core';
import type { EventRoomAction } from './room-actions';
import { actionToEvent } from './room-event-mapper';

const CASES: readonly (readonly [EventRoomAction, Event])[] = [
  [{ type: 'enterRoom', roomId: 'r1' }, { kind: 'RoomEntered', roomId: 'r1' }],
  [{ type: 'openLock', slotId: 's1' }, { kind: 'LockOpened', slotId: 's1' }],
  [{ type: 'useHint', slotId: 's1' }, { kind: 'HintUsed', slotId: 's1' }],
  [
    { type: 'submitAnswer', slotId: 's1', submission: { text: 'aorta' } },
    { kind: 'AnswerSubmitted', slotId: 's1', submission: { text: 'aorta' } },
  ],
  [{ type: 'skip', slotId: 's1' }, { kind: 'Skipped', slotId: 's1' }],
  [{ type: 'challenge', slotId: 's1' }, { kind: 'Challenged', slotId: 's1' }],
  [{ type: 'continueEvidence', slotId: 's1' }, { kind: 'EvidenceContinued', slotId: 's1' }],
  [{ type: 'enterFinalDoor' }, { kind: 'FinalDoorEntered' }],
];

describe('actionToEvent', () => {
  it.each(CASES)('maps %j to exactly one Event of the expected kind', (action, expected) => {
    expect(actionToEvent(action)).toEqual(expected);
  });

  it('covers every event-mapped action type', () => {
    const types = new Set(CASES.map(([a]) => a.type));
    expect(types.size).toBe(8);
  });
});
