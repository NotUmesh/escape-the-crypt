import { describe, expect, it } from 'vitest';
import type { State } from '@escape-the-crypt/core';
import { drawnGhosts } from './drawn-ghosts';

function state(over: Record<string, unknown>): State {
  return {
    currentRoomId: 'r1',
    atFinalDoor: false,
    ghosts: [],
    rooms: [{ roomId: 'r1', dueReturnSlots: [] }],
    finalDoor: { slots: [] },
    ...over,
  } as unknown as State;
}
const ret = (conceptId: string, status: string, returnNumber: 1 | 2 = 1) => ({ slotId: `ret-${conceptId}`, conceptId, status, returnNumber });

describe('drawnGhosts', () => {
  it('draws every pending ghost', () => {
    const s = state({ ghosts: [{ conceptId: 'a', returnNumber: 1, due: false, judgedAnswerCountAtSpawn: 0 }] });
    expect(drawnGhosts(s)).toEqual([{ conceptId: 'a', returnNumber: 1, due: false }]);
  });
  it('keeps a due ghost drawn while its returning question is open in the room', () => {
    const s = state({ rooms: [{ roomId: 'r1', dueReturnSlots: [ret('a', 'open'), ret('b', 'solved')] }] });
    expect(drawnGhosts(s)).toEqual([{ conceptId: 'a', returnNumber: 1, due: true }]);
  });
  it('keeps a due ghost drawn while its seal is open at the final door', () => {
    const s = state({
      atFinalDoor: true,
      finalDoor: {
        slots: [
          { origin: 'return', conceptId: 'a', status: 'open', returnNumber: 2 },
          { origin: 'reserved', conceptId: 'x', status: 'open', returnNumber: null },
          { origin: 'return', conceptId: 'b', status: 'settled', returnNumber: 1 },
        ],
      },
    });
    expect(drawnGhosts(s)).toEqual([{ conceptId: 'a', returnNumber: 2, due: true }]);
  });
  it('draws a concept once even when a new ghost was spawned for it', () => {
    const s = state({
      ghosts: [{ conceptId: 'a', returnNumber: 2, due: false, judgedAnswerCountAtSpawn: 0 }],
      rooms: [{ roomId: 'r1', dueReturnSlots: [ret('a', 'open')] }],
    });
    expect(drawnGhosts(s)).toHaveLength(1);
  });
});
