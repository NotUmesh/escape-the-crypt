import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { flushScene, realScene } from '../../test-support/scene-fixtures';
import { FinalDoor } from './final-door';
import { LanternProvider } from './lantern-context';
import { LANTERN_STORAGE_KEY } from './lantern-setting';
import { RoomScreen } from './room-screen';
import type { SceneLoader } from './use-scene';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');
function build(): SampleCryptResult {
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value;
}
const CRYPT = build();
const loader: SceneLoader = () => Promise.resolve({ ok: true, value: realScene() });

type Screen = 'room' | 'door';
let binding: RoomBinding;
let screen: Screen = 'room';
let withProvider = true;

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  const view =
    screen === 'room'
      ? createElement(RoomScreen, {
          state: binding.state,
          dispatch: binding.dispatch,
          loadSceneImpl: loader,
          viewport: { width: 1280, height: 720 },
        })
      : createElement(FinalDoor, {
          loadSceneImpl: loader,
          viewport: { width: 1280, height: 720 },
          state: binding.state,
          dispatch: binding.dispatch,
          assets: binding.assets,
          rejection: binding.rejection,
          eventLog: binding.eventLog,
        });
  return withProvider ? createElement(LanternProvider, null, view) : view;
}

function send(action: Parameters<RoomBinding['dispatch']>[0]): void {
  act(() => binding.dispatch(action));
}

function skipAllOpen(): void {
  for (let guard = 0; guard < 100; guard += 1) {
    const state = binding.state;
    if (state === null || state.finalDoor.available) return;
    const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
    const open = [...(room?.lockSlots ?? []), ...(room?.dueReturnSlots ?? [])].find((s) => s.status === 'open');
    if (open === undefined) return;
    send({ type: 'skip', slotId: open.slotId });
    if (binding.rejection !== null) {
      send({ type: 'openLock', slotId: open.slotId });
      send({ type: 'skip', slotId: open.slotId });
    }
  }
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  window.localStorage.clear();
  screen = 'room';
  withProvider = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const toggleOf = (c: ParentNode): HTMLButtonElement | null =>
  Array.from(c.querySelectorAll('button')).find((b) => b.textContent === ROOM_PLAY_LABELS.lanternToggle) ?? null;
const atmosphere = (c: ParentNode): Element | null => c.querySelector('[data-testid="atmosphere"]');

describe('Lantern toggle mounted in the room and at the final door', () => {
  const mount = useMount();

  async function openRoom(): Promise<void> {
    screen = 'room';
    mount.render(createElement(Harness));
    send({ type: 'startRun' });
    await flushScene();
  }

  async function openDoor(): Promise<void> {
    screen = 'door';
    mount.render(createElement(Harness));
    send({ type: 'startRun' });
    skipAllOpen();
    send({ type: 'enterFinalDoor' });
    await flushScene();
  }

  it('names the control "Lantern mode" and is not inside the art stage', async () => {
    await openRoom();
    const button = toggleOf(mount.container);
    expect(ROOM_PLAY_LABELS.lanternToggle).toBe('Lantern mode');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.closest('[data-testid="art-stage"]')).toBeNull();
  });

  it('toggles in the room: overlays go, the setting is written, aria-pressed follows', async () => {
    await openRoom();
    expect(atmosphere(mount.container)).not.toBeNull();
    const button = toggleOf(mount.container);
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(LANTERN_STORAGE_KEY)).toBe('on');
    expect(atmosphere(mount.container)).toBeNull();
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem(LANTERN_STORAGE_KEY)).toBe('off');
    expect(atmosphere(mount.container)).not.toBeNull();
  });

  it('keeps the session value with no error shown when the write throws', async () => {
    await openRoom();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const before = mount.container.textContent;
    const button = toggleOf(mount.container);
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(atmosphere(mount.container)).toBeNull();
    expect(mount.container.textContent).toBe(before);
    expect(mount.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows at the playing final door and toggles there', async () => {
    await openDoor();
    expect(binding.state?.atFinalDoor).toBe(true);
    const button = toggleOf(mount.container);
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.closest('[data-testid="art-stage"]')).toBeNull();
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(LANTERN_STORAGE_KEY)).toBe('on');
    expect(atmosphere(mount.container)).toBeNull();
  });

  it('keeps the session value silently at the door when the write throws', async () => {
    await openDoor();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const before = mount.container.textContent;
    const button = toggleOf(mount.container);
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(mount.container.textContent).toBe(before);
  });

  it('renders without a provider as lantern off, and the click does nothing', async () => {
    withProvider = false;
    await openRoom();
    const button = toggleOf(mount.container);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });
});
