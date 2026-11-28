import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FINAL_DOOR_BUTTON_TEXT, ROOM_PLAY_LABELS, runSettingsFor } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { BuildCrypt, BuiltCrypt, RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { twoRoomCrypt } from '../../test-support/multi-room-crypt';
import { failedSceneLoader, flushScene } from '../../test-support/scene-fixtures';
import { RoomScreen } from './room-screen';

let binding: RoomBinding;
let crypt: BuiltCrypt;

function Harness(): ReactNode {
  const build: BuildCrypt = () => ({ ok: true, value: crypt });
  binding = useRoomBinding(build);
  if (binding.state === null) return null;
  return createElement(RoomScreen, {
    loadSceneImpl: failedSceneLoader,
    state: binding.state,
    dispatch: binding.dispatch,
    showSampleLabel: binding.assets?.source !== 'notes',
    renderPanel: () => null,
  });
}

async function setup(mount: ReturnType<typeof useMount>, built: BuiltCrypt): Promise<void> {
  crypt = built;
  mount.render(createElement(Harness));
  act(() => binding.dispatch({ type: 'startRun' }));
  await flushScene();
}

/** Settles every lock of the current room through Skip (twice when an alternate takes over). */
function clearCurrentRoom(): void {
  for (let guard = 0; guard < 8; guard += 1) {
    const room = binding.state?.rooms.find((r) => r.roomId === binding.state?.currentRoomId);
    const open = room?.lockSlots.find((s) => s.status === 'open');
    if (open === undefined) return;
    act(() => binding.dispatch({ type: 'openLock', slotId: open.slotId }));
    act(() => binding.dispatch({ type: 'skip', slotId: open.slotId }));
  }
}

const buttons = (root: ParentNode): string[] => Array.from(root.querySelectorAll('button')).map((b) => b.textContent ?? '');

describe('RoomScreen in a crypt of several rooms', () => {
  const mount = useMount();
  afterEach(() => {
    binding = undefined as unknown as RoomBinding;
  });

  it('shows the room count, and the next-room control only once the room is cleared', async () => {
    await setup(mount, twoRoomCrypt(runSettingsFor('short', 'apprentice')));
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.roomOf(1, 2));
    expect(buttons(mount.container)).not.toContain(ROOM_PLAY_LABELS.nextRoom);
    clearCurrentRoom();
    expect(binding.state?.rooms[0]?.cleared).toBe(true);
    expect(buttons(mount.container)).toContain(ROOM_PLAY_LABELS.nextRoom);
    // The final door is not open yet: room 2 is still to come.
    expect(buttons(mount.container)).not.toContain(FINAL_DOOR_BUTTON_TEXT);
  });

  it('shows the entrance hint only until the first lock is opened', async () => {
    await setup(mount, twoRoomCrypt(runSettingsFor('short', 'apprentice')));
    const hint = () => mount.container.querySelector('.room-screen__entrance-hint');
    expect(hint()?.textContent).toBe(ROOM_PLAY_LABELS.chooseLock);
    act(() => mount.container.querySelector<HTMLButtonElement>('.room-screen__lock-button')?.click());
    expect(hint()).toBeNull();
  });

  it('enters the next room, moves focus to its title, and offers the final door after the last room', async () => {
    await setup(mount, twoRoomCrypt(runSettingsFor('short', 'apprentice')));
    clearCurrentRoom();
    const next = Array.from(mount.container.querySelectorAll('button')).find((b) => b.textContent === ROOM_PLAY_LABELS.nextRoom);
    act(() => next?.click());
    expect(binding.state?.currentRoomId).toBe('room-2');
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.roomOf(2, 2));
    expect(document.activeElement?.id).toBe('room-screen-title');
    clearCurrentRoom();
    expect(buttons(mount.container)).not.toContain(ROOM_PLAY_LABELS.nextRoom);
    expect(buttons(mount.container)).toContain(FINAL_DOOR_BUTTON_TEXT);
  });

  it('says once, in room 1, that the notes filled fewer rooms than the length asked for', async () => {
    await setup(mount, twoRoomCrypt(runSettingsFor('long', 'apprentice')));
    const notice = mount.container.querySelector('[data-testid="crypt-shortened"]');
    expect(notice?.textContent).toBe(ROOM_PLAY_LABELS.cryptShortened(2, 4));
    expect(notice?.textContent).toBe('Your notes had enough for 2 rooms, so this crypt has 2 instead of 4.');
    clearCurrentRoom();
    act(() => binding.dispatch({ type: 'enterRoom', roomId: 'room-2' }));
    expect(mount.container.querySelector('[data-testid="crypt-shortened"]')).toBeNull();
  });

  it('shows no shortened notice when the crypt has the rooms its length asked for', async () => {
    await setup(mount, twoRoomCrypt(runSettingsFor('short', 'apprentice')));
    expect(mount.container.querySelector('[data-testid="crypt-shortened"]')).toBeNull();
  });

  it('shows no hint count for a run with no hints (Lich)', async () => {
    await setup(mount, twoRoomCrypt(runSettingsFor('short', 'lich')));
    expect(mount.container.querySelector('.room-screen__hints')).toBeNull();
    await setup(mount, twoRoomCrypt(runSettingsFor('short', 'gravedigger')));
    expect(mount.container.querySelector('.room-screen__hints')?.textContent).toBe(ROOM_PLAY_LABELS.hintsLeft(2));
  });
});
