import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { realScene } from '../../test-support/scene-fixtures';
import { lockName } from './accessible-names';
import { RoomScreen } from './room-screen';
import type { SceneLoader } from './use-scene';
import type { SceneFile } from './scene-types';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');
const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
const file = JSON.parse(readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8')) as HumanHeartQuestionsFile;
const built = buildHumanHeartSampleCrypt(notes, file);
if (!built.ok) throw new Error('sample crypt failed');
const CRYPT = built.value;

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

let binding: RoomBinding;
let scene: SceneFile;
let loader: SceneLoader;
let viewport = DESKTOP;

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  return createElement(RoomScreen, { state: binding.state, dispatch: binding.dispatch, loadSceneImpl: loader, viewport });
}

async function setup(mount: ReturnType<typeof useMount>): Promise<void> {
  mount.render(createElement(Harness));
  act(() => binding.dispatch({ type: 'startRun' }));
  await act(async () => {
    await Promise.resolve();
  });
}

function currentRoom(state: State | null) {
  return state?.rooms.find((r) => r.roomId === state.currentRoomId);
}

describe('RoomScreen with art', () => {
  const mount = useMount();
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    scene = realScene();
    viewport = DESKTOP;
    loader = () => Promise.resolve({ ok: true, value: scene });
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('stacks background, locks, light passes, door and foreground in that order', async () => {
    await setup(mount);
    const stage = mount.container.querySelector('[data-testid="art-stage"]');
    const layers = Array.from(stage?.querySelectorAll('img.art-layer') ?? []).map((i) => i.getAttribute('data-layer'));
    expect(layers[0]).toBe('background');
    expect(layers.at(-2)).toBe('door');
    expect(layers.at(-1)).toBe('foreground');
    const order = ['background', 'lock', 'light', 'door', 'foreground'];
    const indexes = layers.map((l) => order.indexOf(l ?? ''));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(layers).toContain('lock');
  });

  it('gives every art layer empty alt text and draws at 0,0 of its frame', async () => {
    await setup(mount);
    const images = Array.from(mount.container.querySelectorAll<HTMLImageElement>('img.art-layer'));
    expect(images.length).toBeGreaterThan(3);
    for (const img of images) {
      expect(img.getAttribute('alt')).toBe('');
      expect(img.style.left).toBe('0px');
      expect(img.style.top).toBe('0px');
    }
  });

  it('uses background@2x.webp for high-DPI screens through srcset', async () => {
    await setup(mount);
    const bg = mount.container.querySelector<HTMLImageElement>('img[data-layer="background"]');
    expect(bg?.getAttribute('src')).toBe('/art/rooms/burial-chamber/desktop/background.webp');
    expect(bg?.getAttribute('srcset')).toContain('/art/rooms/burial-chamber/desktop/background@2x.webp 2x');
  });

  it('draws only the lock types the room holds, with one button each', async () => {
    await setup(mount);
    const types = (currentRoom(binding.state)?.lockSlots ?? []).map((s) => s.stationType);
    const drawn = new Set(
      Array.from(mount.container.querySelectorAll('img[data-layer="lock"]')).map((i) => i.getAttribute('data-lock')),
    );
    expect(drawn).toEqual(new Set(types));
    expect(drawn.size).toBeLessThan(6);
    expect(mount.container.querySelectorAll('img[data-layer="light"]')).toHaveLength(0);
    const buttons = Array.from(mount.container.querySelectorAll('.room-hotspot'));
    expect(buttons.map((b) => b.getAttribute('data-lock'))).toHaveLength(types.length);
    for (const absent of ['bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial']) {
      if (!types.includes(absent as never)) {
        expect(mount.container.querySelector(`[data-lock="${absent}"]`)).toBeNull();
      }
    }
  });

  it('names every hotspot button like the plain list and sizes it to at least 44 by 44', async () => {
    await setup(mount);
    const slots = currentRoom(binding.state)?.lockSlots ?? [];
    const buttons = Array.from(mount.container.querySelectorAll<HTMLButtonElement>('.room-hotspot'));
    const names = buttons.map((b) => b.getAttribute('aria-label'));
    expect(names.sort()).toEqual(slots.map((s) => lockName(s.stationType, s.status)).sort());
    for (const b of buttons) {
      expect(parseFloat(b.style.width)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(b.style.height)).toBeGreaterThanOrEqual(44);
    }
  });

  it('emits buttons left to right', async () => {
    await setup(mount);
    const lefts = Array.from(mount.container.querySelectorAll<HTMLButtonElement>('.room-hotspot')).map((b) =>
      parseFloat(b.style.left),
    );
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  });

  it('crossfades to the hover image on pointer enter and on focus, and back', async () => {
    await setup(mount);
    const button = mount.container.querySelector<HTMLButtonElement>('.room-hotspot');
    const type = button?.getAttribute('data-lock') ?? '';
    const hover = () =>
      mount.container.querySelector(`img[data-lock="${type}"][data-file$="-hover.webp"]`)?.getAttribute('data-shown');
    expect(hover()).toBe('false');
    act(() => button?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(hover()).toBe('true');
    act(() => button?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
    expect(hover()).toBe('false');
    act(() => button?.focus());
    expect(hover()).toBe('true');
    act(() => button?.blur());
    expect(hover()).toBe('false');
  });

  it('crops the desktop art on a phone and keeps the buttons usable', async () => {
    viewport = PHONE;
    await setup(mount);
    const stage = mount.container.querySelector('[data-testid="art-stage"]');
    expect(stage?.getAttribute('data-cropped')).toBe('true');
    expect(stage?.getAttribute('data-directory')).toBe('desktop');
    for (const b of Array.from(mount.container.querySelectorAll<HTMLButtonElement>('.room-hotspot'))) {
      expect(parseFloat(b.style.width)).toBeGreaterThanOrEqual(44);
      expect(parseFloat(b.style.left) + parseFloat(b.style.width)).toBeLessThanOrEqual(PHONE.width + 0.01);
    }
  });

  it('uses the mobile set when the scene has a mobile block', async () => {
    const base = realScene();
    scene = { ...base, mobile: { ...base.desktop, size: [1080, 1920] } };
    viewport = PHONE;
    await setup(mount);
    expect(mount.container.querySelector('[data-testid="art-stage"]')?.getAttribute('data-directory')).toBe('mobile');
    expect(mount.container.querySelector('img[data-layer="background"]')?.getAttribute('src')).toContain('/mobile/');
  });

  it('draws the light pass of a solved lock and none for a settled one', async () => {
    await setup(mount);
    const slot = currentRoom(binding.state)?.lockSlots[0];
    if (slot === undefined) throw new Error('no slot');
    const solved = { ...binding.state } as State;
    const rooms = solved.rooms.map((r) =>
      r.roomId === solved.currentRoomId
        ? {
            ...r,
            lockSlots: r.lockSlots.map((s, i) =>
              i === 0 ? { ...s, status: 'solved' as const, candleLit: true } : i === 1 ? { ...s, status: 'settled' as const } : s,
            ),
          }
        : r,
    );
    mount.render(createElement(RoomScreen, { state: { ...solved, rooms }, dispatch: () => undefined, loadSceneImpl: loader, viewport }));
    await act(async () => {
      await Promise.resolve();
    });
    const lights = Array.from(mount.container.querySelectorAll('img[data-layer="light"]')).map((i) => i.getAttribute('data-lock'));
    expect(lights).toEqual([slot.stationType]);
    expect(mount.container.querySelector(`img[data-file="lock-${slot.stationType}-solved.webp"]`)).not.toBeNull();
  });
});

describe('RoomScreen when art fails', () => {
  const mount = useMount();
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    viewport = DESKTOP;
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errors.mockRestore());

  it('falls back to the plain button list, with the same names, when the Scene_File fails', async () => {
    loader = () => Promise.resolve({ ok: false, error: { kind: 'http', status: 404 } });
    await setup(mount);
    expect(mount.container.querySelector('[data-testid="art-stage"]')).toBeNull();
    const slots = currentRoom(binding.state)?.lockSlots ?? [];
    const buttons = Array.from(mount.container.querySelectorAll('.room-screen__lock-button'));
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(slots.map((s) => lockName(s.stationType, s.status)));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith({ file: 'rooms/burial-chamber/scene.json', errorType: 'scene-load-failed' });
  });

  it('logs once for a layer that fails to load, draws nothing for it and keeps every control', async () => {
    loader = () => Promise.resolve({ ok: true, value: realScene() });
    await setup(mount);
    const fg = mount.container.querySelector('img[data-layer="foreground"]');
    act(() => fg?.dispatchEvent(new Event('error')));
    expect(mount.container.querySelector('img[data-layer="foreground"]')).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith({ file: 'desktop/foreground.webp', errorType: 'art-load-failed' });
    const slots = currentRoom(binding.state)?.lockSlots ?? [];
    expect(mount.container.querySelectorAll('.room-hotspot')).toHaveLength(slots.length);
  });
});
