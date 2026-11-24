import { expect } from 'vitest';
import type { State } from '../runtime/state-types';
import { command, expectRejected } from './runtime-model-commands';
import type { RuntimeCommand } from './runtime-model-commands';
import { applyChecked } from './runtime-model-support';

/** Commands for room progression, publishing, shortening, the final door, leave and resume. */

function currentIndex(state: State): number {
  return state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
}

/** Publish the next unpublished room, in order, within the final room count (if known). */
export const nextRoomPublished = (): RuntimeCommand =>
  command('RoomPublished (next room)', (m) => m.started, (m, r) => {
    const limit = r.state.finalRoomCount ?? r.state.rooms.length;
    const next = r.state.rooms.slice(0, limit).find((room) => !room.published);
    if (next === undefined) return;
    expect(applyChecked(r, { kind: 'RoomPublished', roomId: next.roomId }).ok).toBe(true);
    m.published = true;
  });

/** Enter the next room: accepted when Cleared and published, otherwise the expected rejection. */
export const roomAdvanced = (): RuntimeCommand =>
  command('RoomEntered (next room)', (m) => m.entered, (_m, r) => {
    const s = r.state;
    const index = currentIndex(s);
    const next = s.rooms[index + 1];
    if (s.atFinalDoor || index < 0 || next === undefined) return;
    if (s.finalRoomCount !== null && index + 1 >= s.finalRoomCount) return;
    const skipAhead = s.rooms[index + 2];
    if (skipAhead !== undefined) expectRejected(r, { kind: 'RoomEntered', roomId: skipAhead.roomId }, 'room-out-of-order');
    const current = s.rooms[index];
    if (current?.cleared !== true) {
      expectRejected(r, { kind: 'RoomEntered', roomId: next.roomId }, 'room-not-cleared');
    } else if (!next.published) {
      expectRejected(r, { kind: 'RoomEntered', roomId: next.roomId }, 'room-not-published');
    } else {
      expect(applyChecked(r, { kind: 'RoomEntered', roomId: next.roomId }).ok).toBe(true);
      expect(r.state.currentRoomId).toBe(next.roomId);
    }
  });

/** Record the final room count: every room, at least the published ones. */
export const cryptFinalised = (): RuntimeCommand =>
  command('CryptFinalised', (m) => m.published, (_m, r) => {
    if (r.state.finalRoomCount !== null) return;
    const count = r.state.rooms.length;
    expect(applyChecked(r, { kind: 'CryptFinalised', finalRoomCount: count }).ok).toBe(true);
    expect(r.state.finalRoomCount).toBe(count);
  });

/** Shorten the crypt to a count between the published rooms and the current final count. */
export const cryptShortened = (pick: number): RuntimeCommand =>
  command(`CryptShortened #${pick}`, (m) => m.published, (_m, r) => {
    const published = Math.max(1, r.state.rooms.filter((room) => room.published).length);
    const high = r.state.finalRoomCount ?? r.state.rooms.length;
    if (high < published) return;
    const count = published + (pick % (high - published + 1));
    expect(applyChecked(r, { kind: 'CryptShortened', finalRoomCount: count }).ok).toBe(true);
    // Below the published rooms is always refused and leaves State unchanged.
    if (published > 1) expectRejected(r, { kind: 'CryptShortened', finalRoomCount: published - 1 }, 'cannot-shorten-published');
  });

/** Enter the final door: refused until it is available, then every ghost becomes due at once. */
export const finalDoorEntered = (): RuntimeCommand =>
  command('FinalDoorEntered', (m) => m.entered, (_m, r) => {
    if (!r.state.finalDoor.available) {
      expectRejected(r, { kind: 'FinalDoorEntered' }, 'final-door-unavailable');
      return;
    }
    expect(applyChecked(r, { kind: 'FinalDoorEntered' }).ok).toBe(true);
    expect(r.state.atFinalDoor).toBe(true);
    expect(r.state.ghosts).toEqual([]);
  });

/** Leave: only the status changes. A second leave is refused. */
export const runLeft = (): RuntimeCommand =>
  command('RunLeft', (m) => m.started, (_m, r) => {
    const before = r.state;
    if (before.status === 'escaped') return expectRejected(r, { kind: 'RunLeft' }, 'run-finished');
    if (before.status === 'left') return expectRejected(r, { kind: 'RunLeft' }, 'cannot-leave');
    expect(applyChecked(r, { kind: 'RunLeft' }).ok).toBe(true);
    expect(r.state).toEqual({ ...before, status: 'left' });
  }, true);

/** Resume: only the status changes back. Resuming a run that is not left is refused. */
export const runResumed = (): RuntimeCommand =>
  command('RunResumed', (m) => m.started, (_m, r) => {
    const before = r.state;
    if (before.status === 'escaped') return expectRejected(r, { kind: 'RunResumed' }, 'run-finished');
    if (before.status !== 'left') return expectRejected(r, { kind: 'RunResumed' }, 'run-not-left');
    expect(applyChecked(r, { kind: 'RunResumed' }).ok).toBe(true);
    expect(r.state).toEqual({ ...before, status: 'in progress' });
  }, true);

/** While left, every learner action is refused and State is unchanged. */
export const learnerWhileLeft = (): RuntimeCommand =>
  command('learner action while left', (m) => m.started, (_m, r) => {
    if (r.state.status !== 'left') return;
    expectRejected(r, { kind: 'LockOpened', slotId: 'any' }, 'run-left');
    expectRejected(r, { kind: 'Skipped', slotId: 'any' }, 'run-left');
    expectRejected(r, { kind: 'FinalDoorEntered' }, 'run-left');
    expectRejected(r, { kind: 'RoomEntered', roomId: r.state.rooms[0]?.roomId ?? '' }, 'run-left');
  }, true);

/** After the escape every event, including leave and resume, returns run-finished. */
export const eventAfterEscape = (): RuntimeCommand =>
  command('event after escape', (m) => m.started, (_m, r) => {
    if (r.state.status !== 'escaped') return;
    const roomId = r.state.rooms[0]?.roomId ?? '';
    for (const event of [
      { kind: 'RunLeft' },
      { kind: 'RunResumed' },
      { kind: 'FinalDoorEntered' },
      { kind: 'Skipped', slotId: 'any' },
      { kind: 'RoomPublished', roomId },
      { kind: 'CryptShortened', finalRoomCount: r.state.rooms.length },
    ] as const) {
      expectRejected(r, event, 'run-finished');
    }
  }, true);
