import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHumanHeartSampleCrypt,
  FINAL_DOOR_BUTTON_TEXT,
  ROOM_PLAY_LABELS,
  SAMPLE_CRYPT_LABEL,
} from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import type { RoomAction } from '../../state/room-actions';
import { useMount } from '../../test-support/flow-dom';
import { lockName } from './accessible-names';
import { failedSceneLoader, flushScene, realScene } from '../../test-support/scene-fixtures';
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

let loader: SceneLoader = failedSceneLoader;
let binding: RoomBinding;
let dispatched: RoomAction[] = [];

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  const dispatch = (action: RoomAction): void => {
    dispatched.push(action);
    binding.dispatch(action);
  };
  return createElement(RoomScreen, {
    loadSceneImpl: loader,
    state: binding.state,
    dispatch,
    renderPanel: (slot) => createElement('div', { 'data-testid': 'panel' }, slot.slotId),
  });
}

async function setup(mount: ReturnType<typeof useMount>): Promise<void> {
  dispatched = [];
  mount.render(createElement(Harness));
  act(() => binding.dispatch({ type: 'startRun' }));
  await flushScene();
}

function lockButtons(container: ParentNode): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.room-screen__lock-button'));
}

describe('RoomScreen', () => {
  const mount = useMount();
  afterEach(() => {
    loader = failedSceneLoader;
  });
  it('renders no lock button while the scene loads, keeps the other controls, then the plain list on failure', async () => {
    let settle: Parameters<ConstructorParameters<typeof Promise<Awaited<ReturnType<SceneLoader>>>>[0]>[0] = () => undefined;
    loader = () => new Promise((resolve) => (settle = resolve));
    await setup(mount);
    expect(lockButtons(mount.container)).toHaveLength(0);
    expect(mount.container.querySelector('.room-screen__locks')).toBeNull();
    expect(mount.container.textContent).toContain(SAMPLE_CRYPT_LABEL);
    expect(mount.container.querySelector('.room-screen__hints')).not.toBeNull();
    settle({ ok: false, error: { kind: 'network' } });
    await flushScene();
    expect(lockButtons(mount.container).length).toBeGreaterThan(0);
  });
  it('replaces no button once the scene arrives: the first buttons are the art buttons', async () => {
    let settle: Parameters<ConstructorParameters<typeof Promise<Awaited<ReturnType<SceneLoader>>>>[0]>[0] = () => undefined;
    loader = () => new Promise((resolve) => (settle = resolve));
    await setup(mount);
    settle({ ok: true, value: realScene() });
    await flushScene();
    const buttons = lockButtons(mount.container);
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.classList.contains('room-hotspot')).toBe(true);
  });

  it('renders one native button per lock slot in slot order, named by lockName', async () => {
    await setup(mount);
    const room = binding.state?.rooms.find((r) => r.roomId === binding.state?.currentRoomId);
    const expected = (room?.lockSlots ?? []).map((s) => lockName(s.stationType, s.status));
    const buttons = lockButtons(mount.container);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(expected);
    expect(buttons.every((b) => b.tagName === 'BUTTON' && b.type === 'button')).toBe(true);
  });

  it('offers the final door button only once the door is available, and it dispatches enterFinalDoor', async () => {
    await setup(mount);
    const doorButton = (): HTMLButtonElement | null =>
      mount.container.querySelector<HTMLButtonElement>('.room-screen__door-button');
    expect(doorButton()).toBeNull();
    const room = binding.state?.rooms.find((r) => r.roomId === binding.state?.currentRoomId);
    for (const slot of room?.lockSlots ?? []) {
      act(() => binding.dispatch({ type: 'openLock', slotId: slot.slotId }));
      act(() => binding.dispatch({ type: 'skip', slotId: slot.slotId }));
    }
    expect(binding.state?.finalDoor.available).toBe(true);
    expect(doorButton()?.getAttribute('aria-label')).toBe(FINAL_DOOR_BUTTON_TEXT);
    act(() => doorButton()?.click());
    expect(dispatched).toContainEqual({ type: 'enterFinalDoor' });
    expect(binding.state?.atFinalDoor).toBe(true);
  });

  it('headlines the room with its display name by order, never the roomId', async () => {
    await setup(mount);
    const heading = mount.container.querySelector('h1')?.textContent ?? '';
    expect(binding.state?.currentRoomId).toBe('hh-room-1');
    expect(heading).toBe('Burial chamber');
    expect(heading).not.toContain('hh-room-1');
  });

  it('shows the hint count and the sample-crypt label', async () => {
    await setup(mount);
    const text = mount.container.textContent ?? '';
    expect(text).toContain(ROOM_PLAY_LABELS.hintsLeft(binding.state?.remainingHints ?? -1));
    expect(text).toContain(SAMPLE_CRYPT_LABEL);
  });

  it('opens a panel and dispatches openLock for an open slot', async () => {
    await setup(mount);
    const first = lockButtons(mount.container)[0];
    act(() => first?.click());
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe('openLock');
    expect(mount.container.querySelector('[data-testid="panel"]')).not.toBeNull();
  });

  it('shows the challenged label and status text without dispatching for a challenged slot', async () => {
    await setup(mount);
    const slotId = binding.state?.rooms[0]?.lockSlots[0]?.slotId ?? '';
    // The first challenge cracks the seal and brings the Alternate; the second settles the slot.
    for (let i = 0; i < 2; i += 1) {
      act(() => binding.dispatch({ type: 'challenge', slotId }));
      act(() => binding.dispatch({ type: 'continueEvidence', slotId }));
    }
    expect(binding.state?.rooms[0]?.lockSlots[0]?.status).toBe('challenged');
    dispatched = [];
    expect(mount.container.querySelector('.room-screen__challenged')?.textContent).toBe(
      'Challenged: excluded from score',
    );
    const first = lockButtons(mount.container)[0];
    act(() => first?.click());
    expect(dispatched).toEqual([]);
    expect(mount.container.querySelector('[data-testid="slot-status"]')?.textContent).not.toBe('');
    expect(mount.container.querySelector('[data-testid="panel"]')).toBeNull();
  });

  it('dispatches nothing for a settled slot', async () => {
    await setup(mount);
    const slotId = binding.state?.rooms[0]?.lockSlots[0]?.slotId ?? '';
    act(() => binding.dispatch({ type: 'skip', slotId }));
    dispatched = [];
    const first = lockButtons(mount.container)[0];
    act(() => first?.click());
    expect(dispatched).toEqual([]);
    expect(mount.container.querySelector('[data-testid="slot-status"]')?.textContent).toContain('settled');
  });
});

describe('room-screen.css', () => {
  const css = readFileSync(join(__dirname, 'room-screen.css'), 'utf8');

  it('uses no colour literals, imports or remote urls', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/i);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(\s*['"]?http/i);
  });

  it('takes fonts only from the two font tokens', () => {
    const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(families.length).toBeGreaterThan(0);
    for (const f of families) expect(['var(--font-body)', 'var(--font-title)']).toContain(f);
  });

  it('sizes body text 1.125rem by default and 1rem in the phone media query', () => {
    const [base, phone] = css.split('@media');
    expect(base).toMatch(/\.room-screen__panel-slot[\s\S]*?font-size:\s*1\.125rem/);
    expect(phone).toMatch(/max-aspect-ratio/);
    expect(phone).toMatch(/font-size:\s*1rem/);
  });

  it('sets a 44px minimum size and the spectre focus ring from tokens', () => {
    expect(css).toMatch(/min-width:\s*44px/);
    expect(css).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*var\(--focus-ring\)/);
    const tokens = readFileSync(join(__dirname, '..', '..', 'styles', 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--focus-ring:\s*2px solid var\(--spectre-300\)/);
  });
});
