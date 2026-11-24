import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { initial } from './initial';
import {
  selectFinalDoor,
  selectGhosts,
  selectIsCleared,
  selectRoom,
  selectRooms,
  selectSpiritCandles,
} from './selectors';
import type { State } from './state-types';

function richState(): State {
  const base = initial(buildManifest({ rooms: 2, conceptsPerRoom: 2 }), SETTINGS);
  const [r1, r2] = base.rooms;
  if (!r1 || !r2) throw new Error('fixture');
  const [a, b] = r1.lockSlots;
  if (!a || !b) throw new Error('fixture');
  return {
    ...base,
    rooms: [
      {
        ...r1,
        published: true,
        cleared: true,
        lockSlots: [
          { ...a, status: 'solved', candleLit: true, evidencePanelOpen: true },
          { ...b, status: 'open', appliedHint: { questionId: b.currentQuestionId, effect: null } },
        ],
        dueReturnSlots: [
          {
            slotId: 'ret-1',
            conceptId: 'concept-x',
            returnNumber: 2,
            currentQuestionId: 'q-r',
            currentQuestionType: 'seance-board',
            label: 'review',
            status: 'solved',
            candleLit: true,
            appliedHint: null,
            evidencePanelOpen: false,
          },
        ],
        spiritCandles: [{ conceptId: 'concept-x', returnSlotId: 'ret-1' }],
      },
      r2,
    ],
    ghosts: [{ conceptId: 'concept-y', returnNumber: 1, judgedAnswerCountAtSpawn: 2, due: false }],
    finalDoor: {
      available: true,
      slots: [
        {
          slotId: 'fd-1',
          origin: 'reserved',
          conceptId: 'concept-z',
          returnNumber: null,
          currentQuestionId: 'q-f',
          currentQuestionType: 'cursed-object',
          label: null,
          status: 'open',
          candleLit: false,
          appliedHint: null,
          evidencePanelOpen: false,
        },
      ],
      spiritCandles: [{ conceptId: 'concept-z', returnSlotId: 'fd-2' }],
    },
  };
}

describe('selectors', () => {
  it('lists published rooms only, with lock fields and the hint and evidence flags', () => {
    const state = richState();
    const rooms = selectRooms(state);
    expect(rooms.map((r) => r.roomId)).toEqual([state.rooms[0]!.roomId]);
    const [a, b] = rooms[0]!.lockSlots;
    expect(a).toMatchObject({ status: 'solved', candleLit: true, evidencePanelOpen: true, appliedHint: null });
    expect(b?.appliedHint).not.toBeNull();
    expect(b?.stationType).toBe(state.rooms[0]!.lockSlots[1]!.stationType);
    expect(b?.currentQuestionType).toBe(state.rooms[0]!.lockSlots[1]!.currentQuestionType);
  });

  it('projects return slots, spirit candles and the cleared flag', () => {
    const state = richState();
    const id = state.rooms[0]!.roomId;
    expect(selectRoom(state, id)?.returnSlots[0]).toMatchObject({
      slotId: 'ret-1',
      conceptId: 'concept-x',
      returnNumber: 2,
      currentQuestionType: 'seance-board',
      status: 'solved',
    });
    expect(selectSpiritCandles(state, id)).toEqual([{ conceptId: 'concept-x', returnSlotId: 'ret-1' }]);
    expect(selectIsCleared(state, id)).toBe(true);
    expect(selectIsCleared(state, state.rooms[1]!.roomId)).toBe(false);
    expect(selectRoom(state, state.rooms[1]!.roomId)).toBeNull();
    expect(selectSpiritCandles(state, 'nope')).toEqual([]);
  });

  it('projects ghosts without the spawn count', () => {
    expect(selectGhosts(richState())).toEqual([{ conceptId: 'concept-y', returnNumber: 1, due: false }]);
  });

  it('projects the final door with origin, type, status and spirit candles', () => {
    const door = selectFinalDoor(richState());
    expect(door.available).toBe(true);
    expect(door.slots[0]).toMatchObject({ origin: 'reserved', currentQuestionType: 'cursed-object', status: 'open' });
    expect(door.spiritCandles).toHaveLength(1);
  });

  it('is JSON-safe and does not change State', () => {
    const state = richState();
    const before = JSON.stringify(state);
    const view = { rooms: selectRooms(state), door: selectFinalDoor(state), ghosts: selectGhosts(state) };
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(state)).toBe(before);
  });
});
