import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, LockSlotState, LockType, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { flushScene, realScene } from '../../test-support/scene-fixtures';
import { lockName } from './accessible-names';
import { RoomScreen } from './room-screen';
import type { SceneLoader } from './use-scene';

// Requirements 24.3, 24.8, 7.6: only the lock types in the current room are drawn, and the
// Art_Room comes from the room's position in the list, never from its roomId text.
const SAMPLES = join(process.cwd(), '..', '..', 'samples');
const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
const file = JSON.parse(readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8')) as HumanHeartQuestionsFile;
const built = buildHumanHeartSampleCrypt(notes, file);
if (!built.ok) throw new Error('sample crypt failed');
const CRYPT = built.value;
const VIEWPORT = { width: 1280, height: 720 };
const ALL_TYPES: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];

let binding: RoomBinding;
let requested: string[];
let loader: SceneLoader;
let variant: (state: State) => State;

function Harness() {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  return createElement(RoomScreen, {
    state: variant(binding.state),
    dispatch: binding.dispatch,
    loadSceneImpl: loader,
    viewport: VIEWPORT,
  });
}

function drawnTypes(container: ParentNode, selector: string): Set<string | null> {
  return new Set(Array.from(container.querySelectorAll(selector)).map((el) => el.getAttribute('data-lock')));
}

/** A manifest variant: the current room keeps only the slots whose type passes `keep`, and may take a new id. */
function roomVariant(keep: (slot: LockSlotState) => boolean, newRoomId?: string, over?: Partial<LockSlotState>) {
  return (state: State): State => {
    const rooms = state.rooms.map((room) => ({
      ...room,
      roomId: newRoomId ?? room.roomId,
      lockSlots: room.lockSlots.filter(keep).map((slot) => ({ ...slot, ...over })),
    }));
    return { ...state, rooms, currentRoomId: newRoomId ?? state.currentRoomId };
  };
}

async function setup(mount: ReturnType<typeof useMount>): Promise<void> {
  mount.render(createElement(Harness));
  act(() => binding.dispatch({ type: 'startRun' }));
  await flushScene();
}

describe('RoomScreen draws only the lock types the room holds', () => {
  const mount = useMount();
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    requested = [];
    variant = (state) => state;
    loader = (artRoom) => {
      requested.push(artRoom);
      return Promise.resolve({ ok: true, value: realScene(artRoom) });
    };
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('draws no Lock_Layer, Light_Pass or Hotspot_Button for any type absent from the room', async () => {
    // The scene has art for all six types; the room holds one solved rune cipher and nothing else.
    variant = roomVariant((slot) => slot.stationType === 'rune-cipher', undefined, { status: 'solved', candleLit: true });
    await setup(mount);
    const present = ['rune-cipher'];
    expect(drawnTypes(mount.container, 'img[data-layer="lock"]')).toEqual(new Set(present));
    expect(drawnTypes(mount.container, 'img[data-layer="light"]')).toEqual(new Set(present));
    expect(drawnTypes(mount.container, '.room-hotspot')).toEqual(new Set(present));
    for (const absent of ALL_TYPES.filter((type) => !present.includes(type))) {
      expect(mount.container.querySelector(`[data-lock="${absent}"]`), absent).toBeNull();
    }
  });

  it('follows the room when its lock types change', async () => {
    variant = roomVariant((slot) => slot.stationType === 'seance-board');
    await setup(mount);
    expect(drawnTypes(mount.container, '.room-hotspot')).toEqual(new Set(['seance-board']));
    expect(drawnTypes(mount.container, 'img[data-layer="lock"]')).toEqual(new Set(['seance-board']));
    expect(mount.container.querySelector('[data-lock="rune-cipher"]')).toBeNull();
  });

  it('draws nothing for a lock type the scene has no art for, and keeps a plain button for it', async () => {
    loader = (artRoom) => {
      requested.push(artRoom);
      const scene = realScene(artRoom);
      const locks = { ...scene.desktop.locks };
      delete locks['seance-board'];
      return Promise.resolve({ ok: true, value: { ...scene, desktop: { ...scene.desktop, locks } } });
    };
    await setup(mount);
    expect(mount.container.querySelector('img[data-lock="seance-board"]')).toBeNull();
    expect(mount.container.querySelector('.room-hotspot[data-lock="seance-board"]')).toBeNull();
    const plainNames = Array.from(mount.container.querySelectorAll('.room-screen__lock-button:not(.room-hotspot)')).map((b) => b.getAttribute('aria-label'));
    expect(plainNames).toEqual([lockName('seance-board', 'open')]);
  });

  it.each(['sunken-chapel', 'library-of-bones', 'not-an-art-room-name'])(
    'picks the Art_Room by position, not by the roomId "%s"',
    async (roomId) => {
      variant = roomVariant(() => true, roomId);
      await setup(mount);
      expect(new Set(requested)).toEqual(new Set(['burial-chamber']));
      const background = mount.container.querySelector('img[data-layer="background"]');
      expect(background?.getAttribute('src')).toContain('/art/rooms/burial-chamber/');
    },
  );

  it('picks the next Art_Room for the room in second position, whatever its id says', async () => {
    variant = (state) => {
      const first = state.rooms[0];
      if (first === undefined) throw new Error('no room');
      const second = { ...first, roomId: 'burial-chamber' };
      const rooms = [{ ...first, roomId: 'sunken-chapel' }, second];
      return { ...state, rooms, currentRoomId: 'burial-chamber' };
    };
    await setup(mount);
    expect(new Set(requested)).toEqual(new Set(['library-of-bones']));
    const background = mount.container.querySelector('img[data-layer="background"]');
    expect(background?.getAttribute('src')).toContain('/art/rooms/library-of-bones/');
  });
});
