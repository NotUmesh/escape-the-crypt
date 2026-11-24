import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { initial } from './initial';
import { roomCleared } from './notices';
import { isRoomCleared, materialiseDueReturns, settleRoom, updateRoomCleared } from './room-clearing';
import type { ReturnSlotState, SlotStatus, State } from './state-types';

const STATUSES: readonly SlotStatus[] = ['open', 'solved', 'settled', 'challenged'];

function returnSlot(slotId: string, status: SlotStatus): ReturnSlotState {
  return {
    slotId,
    conceptId: 'c',
    returnNumber: 1,
    currentQuestionId: 'q',
    currentQuestionType: 'rune-cipher',
    label: null,
    status,
    candleLit: status === 'solved',
    appliedHint: null,
    evidencePanelOpen: false,
  };
}

function stateWith(statuses: readonly SlotStatus[], returns: readonly SlotStatus[], published = true): State {
  const base = initial(buildManifest({ rooms: 1, conceptsPerRoom: statuses.length }), SETTINGS);
  const room = base.rooms[0];
  if (!room) throw new Error('fixture');
  return {
    ...base,
    rooms: [
      {
        ...room,
        published,
        lockSlots: room.lockSlots.map((s, i) => ({ ...s, status: statuses[i] ?? 'open' })),
        dueReturnSlots: returns.map((s, i) => returnSlot(`ret-${i}`, s)),
      },
    ],
  };
}

describe('Return_Slot insertion before clearing', () => {
  function withGhost(atSpawn: number, judged: number, returnNumber: 1 | 2 = 1): State {
    const base = stateWith(['settled'], []);
    const conceptId = base.manifest.rooms[0]!.lockSlots[0]!.conceptId;
    return {
      ...base,
      judgedAnswerCount: judged,
      ghosts: [{ conceptId, returnNumber, judgedAnswerCountAtSpawn: atSpawn, due: false }],
    };
  }

  it('adds the due ghost as a Return_Slot and keeps the room uncleared', () => {
    const state = withGhost(0, 3);
    const result = settleRoom(state, state.rooms[0]!.roomId);
    expect(result.state.ghosts).toEqual([]);
    expect(result.state.rooms[0]!.dueReturnSlots).toHaveLength(1);
    expect(result.state.rooms[0]!.cleared).toBe(false);
    expect(result.notices).toEqual([]);
    expect(result.state.rooms[0]!.lockSlots).toEqual(state.rooms[0]!.lockSlots);
  });

  it('clears the room when no ghost is due, and carries a pending ghost over', () => {
    const state = withGhost(1, 3);
    const result = settleRoom(state, state.rooms[0]!.roomId);
    expect(result.state.ghosts).toEqual(state.ghosts);
    expect(result.state.rooms[0]!.cleared).toBe(true);
  });

  it('labels by show history and records the return question as shown', () => {
    const state = withGhost(0, 3, 2);
    const next = materialiseDueReturns(state, state.rooms[0]!.roomId);
    expect(next.rooms[0]!.dueReturnSlots[0]).toMatchObject({ returnNumber: 2, label: null });
    expect(next.concepts[0]!.shownQuestionIds).toHaveLength(1);
  });
});

describe('room clearing', () => {
  it('is not cleared while a lock is open', () => {
    expect(isRoomCleared(stateWith(['solved', 'open'], []).rooms[0]!)).toBe(false);
  });

  it('is not cleared while a due return is open', () => {
    expect(isRoomCleared(stateWith(['solved', 'settled'], ['open']).rooms[0]!)).toBe(false);
  });

  it('is not cleared when unpublished', () => {
    expect(isRoomCleared(stateWith(['solved'], [], false).rooms[0]!)).toBe(false);
  });

  it('marks the room cleared once, with one notice, leaving lock slots unchanged', () => {
    const state = stateWith(['settled', 'challenged'], ['settled']);
    const roomId = state.rooms[0]!.roomId;
    const first = updateRoomCleared(state, roomId);
    expect(first.state.rooms[0]!.cleared).toBe(true);
    expect(first.state.rooms[0]!.lockSlots).toEqual(state.rooms[0]!.lockSlots);
    expect(first.notices).toEqual([roomCleared(roomId)]);
    const second = updateRoomCleared(first.state, roomId);
    expect(second.notices).toEqual([]);
    expect(second.state).toBe(first.state);
  });

  it('returns the same state for an unknown room', () => {
    const state = stateWith(['solved'], []);
    expect(updateRoomCleared(state, 'nope')).toEqual({ state, notices: [] });
  });

  it('clears when every slot is done, whatever the statuses', () => {
    const done = fc.constantFrom<SlotStatus>('solved', 'settled', 'challenged');
    fc.assert(
      fc.property(fc.array(done, { minLength: 1, maxLength: 5 }), fc.array(done, { maxLength: 3 }), (locks, rets) => {
        expect(isRoomCleared(stateWith(locks, rets).rooms[0]!)).toBe(true);
      }),
    );
  });

  it('does not clear when any slot is open', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...STATUSES), { minLength: 1, maxLength: 5 }),
        fc.array(fc.constantFrom(...STATUSES), { maxLength: 3 }),
        (locks, rets) => {
          const anyOpen = [...locks, ...rets].includes('open');
          expect(isRoomCleared(stateWith(locks, rets).rooms[0]!)).toBe(!anyOpen);
        },
      ),
    );
  });
});
