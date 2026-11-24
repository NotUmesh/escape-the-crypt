import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { apply } from './apply';
import { initial } from './initial';
import { SETTINGS } from '../test-support/run-settings';
import type { CryptManifest } from './manifest-types';
import type { State } from './state-types';

const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 3 });
const start = { kind: 'RunStarted', manifestId: manifest.manifestId } as const;

describe('RunStarted', () => {
  it('starts the run and sets remaining hints from the allowance', () => {
    const result = apply(initial(manifest, SETTINGS), start);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('in progress');
    expect(result.state.remainingHints).toBe(3);
    expect(result.state.settings).toEqual(SETTINGS);
    expect(result.notices).toEqual([]);
  });

  it('rejects a different manifest ID with manifest-mismatch', () => {
    const result = apply(initial(manifest, SETTINGS), { kind: 'RunStarted', manifestId: 'other' });
    expect(result).toEqual({ ok: false, error: { kind: 'manifest-mismatch' } });
  });

  it('rejects a second start with run-already-started', () => {
    const first = apply(initial(manifest, SETTINGS), start);
    if (!first.ok) throw new Error('setup');
    expect(apply(first.state, start)).toEqual({ ok: false, error: { kind: 'run-already-started' } });
  });

  it('returns the invalid-manifest error from the check and leaves state unchanged', () => {
    const room = manifest.rooms[0];
    const slot = room?.lockSlots[0];
    if (!room || !slot) throw new Error('fixture');
    const bad: CryptManifest = {
      ...manifest,
      rooms: [{ ...room, lockSlots: [...room.lockSlots, { ...slot, slotId: 'again' }] }],
    };
    const state = initial(bad, SETTINGS);
    const before = JSON.stringify(state);
    expect(apply(state, start)).toEqual({
      ok: false,
      error: { kind: 'invalid-manifest', room: 'room-1', lockType: slot.stationType },
    });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('CryptFinalised and CryptShortened', () => {
  const plain = buildManifest({ rooms: 3, conceptsPerRoom: 2, alternates: false });
  const roomIds = plain.rooms.map((r) => r.roomId);

  function play(...events: Parameters<typeof apply>[1][]): State {
    let state = initial(plain, SETTINGS);
    for (const event of [{ kind: 'RunStarted', manifestId: plain.manifestId } as const, ...events]) {
      const result = apply(state, event);
      if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
      state = result.state;
    }
    return state;
  }

  function clearRoom(index: number): Parameters<typeof apply>[1][] {
    const room = plain.rooms[index];
    if (!room) throw new Error('fixture');
    return [
      { kind: 'RoomPublished', roomId: room.roomId },
      { kind: 'RoomEntered', roomId: room.roomId },
      ...room.lockSlots.map((s) => ({ kind: 'Skipped', slotId: s.slotId }) as const),
    ];
  }

  it('records the final room count, even before the run starts', () => {
    const result = apply(initial(plain, SETTINGS), { kind: 'CryptFinalised', finalRoomCount: 3 });
    expect(result.ok && result.state.finalRoomCount).toBe(3);
  });

  it('opens the Final_Door only when every room up to the count is Cleared', () => {
    const afterOne = play(...clearRoom(0));
    expect(afterOne.rooms[0]?.cleared).toBe(true);
    const finalised = apply(afterOne, { kind: 'CryptFinalised', finalRoomCount: 2 });
    expect(finalised.ok && finalised.state.finalDoor.available).toBe(false);

    const afterTwo = play(
      { kind: 'CryptFinalised', finalRoomCount: 2 },
      ...clearRoom(0),
      ...clearRoom(1),
    );
    expect(afterTwo.finalDoor.available).toBe(true);
  });

  it('opens the Final_Door when the count is recorded after the rooms are Cleared', () => {
    const state = play(...clearRoom(0), ...clearRoom(1));
    expect(state.finalDoor.available).toBe(false);
    const result = apply(state, { kind: 'CryptShortened', finalRoomCount: 2 });
    expect(result.ok && result.state.finalDoor.available).toBe(true);
  });

  it('records a shortened count at or above the published count and leaves rooms unchanged', () => {
    const state = play({ kind: 'CryptFinalised', finalRoomCount: 3 }, ...clearRoom(0), ...clearRoom(1));
    const result = apply(state, { kind: 'CryptShortened', finalRoomCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.finalRoomCount).toBe(2);
    expect(result.state.rooms).toEqual(state.rooms);
    expect(roomIds).toHaveLength(3);
  });

  it('rejects shortening below the published count and leaves state unchanged', () => {
    const state = play(...clearRoom(0), ...clearRoom(1));
    const before = JSON.stringify(state);
    expect(apply(state, { kind: 'CryptShortened', finalRoomCount: 1 })).toEqual({
      ok: false,
      error: { kind: 'cannot-shorten-published' },
    });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('RunLeft and RunResumed', () => {
  const running = (): State => {
    const result = apply(initial(manifest, SETTINGS), start);
    if (!result.ok) throw new Error('setup');
    return result.state;
  };

  it('leaves and resumes, changing only the status', () => {
    const state = running();
    const left = apply(state, { kind: 'RunLeft' });
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.state).toEqual({ ...state, status: 'left' });
    expect(left.state.status).not.toBe('escaped');
    const back = apply(left.state, { kind: 'RunResumed' });
    expect(back.ok && back.state).toEqual(state);
  });

  it('rejects a second RunLeft with cannot-leave and resume of a running run with run-not-left', () => {
    const state = running();
    const left = apply(state, { kind: 'RunLeft' });
    if (!left.ok) throw new Error('setup');
    expect(apply(left.state, { kind: 'RunLeft' })).toEqual({ ok: false, error: { kind: 'cannot-leave' } });
    expect(apply(state, { kind: 'RunResumed' })).toEqual({ ok: false, error: { kind: 'run-not-left' } });
  });

  it('rejects both with run-not-started before the start and run-finished after escape', () => {
    const fresh = initial(manifest, SETTINGS);
    for (const kind of ['RunLeft', 'RunResumed'] as const) {
      expect(apply(fresh, { kind })).toEqual({ ok: false, error: { kind: 'run-not-started' } });
      expect(apply({ ...running(), status: 'escaped' }, { kind })).toEqual({
        ok: false,
        error: { kind: 'run-finished' },
      });
    }
  });
});
