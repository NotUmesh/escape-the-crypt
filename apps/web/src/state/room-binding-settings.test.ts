import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSettingsFor } from '@escape-the-crypt/core';
import { SAMPLE_CRYPT } from '../test-support/sample-bundle';
import { twoRoomCrypt } from '../test-support/multi-room-crypt';
import { RUN_SETTINGS, requestedRooms, startEvents, useRoomBinding } from './room-binding';
import type { BuildCrypt, BuiltCrypt, RoomBinding } from './room-binding';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let current: RoomBinding;
function Probe({ buildCrypt }: { readonly buildCrypt: BuildCrypt }): null {
  current = useRoomBinding(buildCrypt);
  return null;
}
function start(crypt: BuiltCrypt): void {
  const buildCrypt: BuildCrypt = () => ({ ok: true, value: crypt });
  act(() => root.render(createElement(Probe, { buildCrypt })));
  act(() => current.dispatch({ type: 'startRun' }));
}
beforeEach(() => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('start events for a multi-room crypt', () => {
  it('publishes every room, finalises at the length asked for, and enters room 1', () => {
    const crypt = twoRoomCrypt(runSettingsFor('short', 'apprentice'));
    expect(startEvents(crypt)).toEqual([
      { kind: 'RunStarted', manifestId: 'crypt-two-rooms-test' },
      { kind: 'RoomPublished', roomId: 'room-1' },
      { kind: 'RoomPublished', roomId: 'room-2' },
      { kind: 'CryptFinalised', finalRoomCount: 2 },
      { kind: 'RoomEntered', roomId: 'room-1' },
    ]);
  });

  it('shortens a generated crypt that has fewer rooms than its length asked for', () => {
    const crypt = twoRoomCrypt(runSettingsFor('long', 'apprentice'));
    expect(requestedRooms(crypt)).toBe(4);
    const events = startEvents(crypt);
    expect(events.filter((e) => e.kind === 'CryptFinalised' || e.kind === 'CryptShortened')).toEqual([
      { kind: 'CryptFinalised', finalRoomCount: 4 },
      { kind: 'CryptShortened', finalRoomCount: 2 },
    ]);
    start(crypt);
    expect(current.phase).toBe('running');
    expect(current.state?.finalRoomCount).toBe(2);
    expect(current.state?.rooms.map((r) => r.published)).toEqual([true, true]);
    expect(current.state?.currentRoomId).toBe('room-1');
  });

  it('never shortens the sample, which has a fixed size', () => {
    const sample: BuiltCrypt = { ...SAMPLE_CRYPT, settings: runSettingsFor('short', 'lich') };
    expect(requestedRooms(sample)).toBe(1);
    expect(startEvents(sample).some((e) => e.kind === 'CryptShortened')).toBe(false);
  });
});

describe('run settings follow the crypt', () => {
  it('starts with the chosen difficulty: Lich has no hints, Gravedigger two', () => {
    start(twoRoomCrypt(runSettingsFor('short', 'lich')));
    expect(current.state?.settings).toEqual({ length: 'short', difficulty: 'lich', hintAllowance: 0 });
    expect(current.state?.remainingHints).toBe(0);
    start({ ...SAMPLE_CRYPT, settings: runSettingsFor('short', 'gravedigger') });
    expect(current.state?.remainingHints).toBe(2);
  });

  it('uses the defaults when a crypt carries no settings', () => {
    start(SAMPLE_CRYPT);
    expect(current.state?.settings).toEqual(RUN_SETTINGS);
    expect(RUN_SETTINGS).toEqual({ length: 'short', difficulty: 'apprentice', hintAllowance: 3 });
  });

  it('keeps the settings on Play again', () => {
    start(twoRoomCrypt(runSettingsFor('standard', 'gravedigger')));
    act(() => current.dispatch({ type: 'useHint', slotId: current.state?.rooms[0]?.lockSlots[0]?.slotId ?? '' }));
    act(() => current.dispatch({ type: 'playAgain' }));
    expect(current.state?.settings).toEqual({ length: 'standard', difficulty: 'gravedigger', hintAllowance: 2 });
    expect(current.state?.remainingHints).toBe(2);
  });
});
