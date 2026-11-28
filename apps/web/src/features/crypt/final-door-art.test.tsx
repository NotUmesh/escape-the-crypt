import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt, FINAL_DOOR_STATUS_LABELS } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { failedSceneLoader, flushScene, realScene } from '../../test-support/scene-fixtures';
import { sealName } from './accessible-names';
import { FinalDoor } from './final-door';
import type { ViewportPoint } from './hotspot-geometry';
import { layoutScene, partitionDrawnSlots } from './scene-layout';
import type { SceneLoader } from './use-scene';

const SAMPLES = join(process.cwd(), '..', '..', 'samples');
const built = buildHumanHeartSampleCrypt(
  readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8'),
  JSON.parse(readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8')) as HumanHeartQuestionsFile,
);
if (!built.ok) throw new Error('sample crypt failed');
const CRYPT = built.value;
const SCENE = realScene();
const VIEWPORT = { width: 1280, height: 720 };

let binding: RoomBinding;
let loader: SceneLoader = () => Promise.resolve({ ok: true, value: SCENE });

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  return binding.state.status === 'escaped'
    ? createElement(FinalDoor, { escaped: true, state: binding.state, onOpenAutopsy: () => undefined, loadSceneImpl: loader, viewport: VIEWPORT })
    : createElement(FinalDoor, {
        state: binding.state,
        dispatch: binding.dispatch,
        assets: binding.assets,
        rejection: binding.rejection,
        eventLog: binding.eventLog,
        notices: binding.notices,
        loadSceneImpl: loader,
        viewport: VIEWPORT,
      });
}

function send(action: Parameters<RoomBinding['dispatch']>[0]): void {
  act(() => binding.dispatch(action));
}

function skipEverything(): void {
  for (let guard = 0; guard < 100; guard += 1) {
    const state = binding.state;
    if (state === null || state.status !== 'in progress') return;
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

/** Ray casting. Good enough for the simple door polygon. */
function inside(polygon: readonly ViewportPoint[], p: ViewportPoint): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

describe('FinalDoor with art', () => {
  const mount = useMount();

  async function atDoor(): Promise<void> {
    mount.render(createElement(Harness));
    send({ type: 'startRun' });
    skipEverything();
    send({ type: 'enterFinalDoor' });
    await flushScene();
  }

  it('holds the seals while the scene loads, then draws them on the door', async () => {
    let resolveScene: (value: Awaited<ReturnType<SceneLoader>>) => void = () => undefined;
    const original = loader;
    loader = () => new Promise((resolve) => (resolveScene = resolve));
    try {
      await atDoor();
      expect(mount.container.querySelector('[data-testid="final-door-seals"]')).toBeNull();
      expect(mount.container.querySelector('.final-door__seal-button')).toBeNull();
      resolveScene({ ok: true, value: SCENE });
      await flushScene();
      expect(mount.container.querySelectorAll('.final-door__seal').length).toBeGreaterThan(0);
    } finally {
      loader = original;
    }
  });

  it('draws every seal at a point inside the door polygon, in slot order, with its label and name', async () => {
    await atDoor();
    const slots = binding.state?.finalDoor.slots ?? [];
    const room = binding.state?.rooms.find((r) => r.roomId === binding.state?.currentRoomId);
    const { drawn } = partitionDrawnSlots(SCENE, room?.lockSlots ?? []);
    const polygon = layoutScene(SCENE, drawn, VIEWPORT, false).door.polygon;
    const items = Array.from(mount.container.querySelectorAll<HTMLElement>('.final-door__seal'));
    expect(items).toHaveLength(slots.length);
    const xs = items.map((item) => parseFloat(item.style.left));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    items.forEach((item, index) => {
      expect(inside(polygon, { x: parseFloat(item.style.left), y: parseFloat(item.style.top) })).toBe(true);
      const status = slots[index]?.status ?? 'open';
      expect(item.textContent).toContain(FINAL_DOOR_STATUS_LABELS[status]);
      expect(item.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(sealName(index + 1, status));
    });
    const doorFiles = Array.from(mount.container.querySelectorAll('img[data-layer="door"]')).map((i) =>
      i.getAttribute('data-file'),
    );
    expect(doorFiles).toEqual(['door-open.webp', 'light-door.webp']);
  });

  it('keeps a plain seal list when the scene fails', async () => {
    const original = loader;
    loader = failedSceneLoader;
    try {
      await atDoor();
      expect(mount.container.querySelector('[data-testid="art-stage"]')).toBeNull();
      const seals = mount.container.querySelectorAll<HTMLElement>('.final-door__seal');
      expect(seals.length).toBeGreaterThan(0);
      for (const seal of seals) expect(seal.style.left).toBe('');
    } finally {
      loader = original;
    }
  });

  it('shows the open door with its light behind the escape message', async () => {
    await atDoor();
    for (let guard = 0; guard < 20 && binding.state?.status === 'in progress'; guard += 1) {
      const open = binding.state.finalDoor.slots.find((s) => s.status === 'open');
      if (open === undefined) break;
      send({ type: 'openLock', slotId: open.slotId });
      send({ type: 'skip', slotId: open.slotId });
    }
    await flushScene();
    expect(binding.state?.status).toBe('escaped');
    const view = mount.container.querySelector('[data-testid="escape-view"]');
    expect(view).not.toBeNull();
    const doorFiles = Array.from(view?.querySelectorAll('img[data-layer="door"]') ?? []).map((i) =>
      i.getAttribute('data-file'),
    );
    expect(doorFiles).toEqual(['door-open.webp', 'light-door.webp']);
    expect(view?.querySelectorAll('button.lantern-toggle')).toHaveLength(1);
    expect(view?.querySelectorAll('button:not(.lantern-toggle)')).toHaveLength(1);
    expect(view?.querySelector('.final-door__seals')).toBeNull();
  });
});
