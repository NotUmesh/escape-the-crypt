import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHumanHeartSampleCrypt,
  ESCAPE_COPY,
  FINAL_DOOR_BUTTON_TEXT,
  FINAL_DOOR_STATUS_LABELS,
  ROOM_PLAY_LABELS,
} from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult, SlotStatus, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { sealName } from './accessible-names';
import { failedSceneLoader, flushScene } from '../../test-support/scene-fixtures';
import { FinalDoor } from './final-door';

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

let binding: RoomBinding;
let override: ((state: State) => State) | null = null;

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  if (binding.state === null) return null;
  return createElement(FinalDoor, {
    loadSceneImpl: failedSceneLoader,
    state: override === null ? binding.state : override(binding.state),
    dispatch: binding.dispatch,
    assets: binding.assets,
    rejection: binding.rejection,
    eventLog: binding.eventLog,
  });
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

function withStatuses(statuses: readonly SlotStatus[]): (state: State) => State {
  return (state) => ({
    ...state,
    finalDoor: {
      ...state.finalDoor,
      slots: state.finalDoor.slots.map((s, i) => ({ ...s, status: statuses[i % statuses.length] ?? 'open' })),
    },
  });
}

afterEach(() => {
  override = null;
});

describe('FinalDoor', () => {
  const mount = useMount();

  function start(): void {
    mount.render(createElement(Harness));
    send({ type: 'startRun' });
  }

  async function atDoor(): Promise<void> {
    start();
    skipAllOpen();
    send({ type: 'enterFinalDoor' });
    await flushScene();
  }

  it('shows a closed door with no control while it is not available', () => {
    start();
    expect(binding.state?.finalDoor.available).toBe(false);
    expect(mount.container.querySelector('[data-testid="final-door"]')).not.toBeNull();
    expect(mount.container.querySelectorAll('button')).toHaveLength(0);
  });

  it('offers one native button when available and dispatches enterFinalDoor', () => {
    start();
    skipAllOpen();
    expect(binding.state?.finalDoor.available).toBe(true);
    const buttons = mount.container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('aria-label')).toBe(FINAL_DOOR_BUTTON_TEXT);
    act(() => buttons[0]?.click());
    expect(binding.state?.atFinalDoor).toBe(true);
  });

  it('draws one labelled seal per slot in order, broken when not open', async () => {
    await atDoor();
    const slotCount = binding.state?.finalDoor.slots.length ?? 0;
    expect(slotCount).toBeGreaterThan(0);
    const statuses: SlotStatus[] = ['open', 'solved', 'settled', 'challenged'];
    override = withStatuses(statuses);
    act(() => binding.dispatch({ type: 'enterFinalDoor' }));
    const items = Array.from(mount.container.querySelectorAll('.final-door__seal'));
    expect(items).toHaveLength(slotCount);
    items.forEach((item, i) => {
      const status = statuses[i % statuses.length] ?? 'open';
      expect(item.textContent).toContain(FINAL_DOOR_STATUS_LABELS[status]);
      expect(item.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(sealName(i + 1, status));
      expect(item.querySelector('svg')?.getAttribute('data-broken')).toBe(String(status !== 'open'));
      expect(item.querySelector('button') !== null).toBe(status === 'open');
    });
  });

  it('opens the shared question panel on the right from a seal control', async () => {
    await atDoor();
    const seal = mount.container.querySelector<HTMLButtonElement>('.final-door__seal-button');
    expect(seal).not.toBeNull();
    act(() => seal?.click());
    const panel = mount.container.querySelector('.question-panel');
    expect(panel?.getAttribute('data-side')).toBe('right');
    const labels = Array.from(panel?.querySelectorAll('button') ?? []).map((b) => b.textContent);
    expect(labels).toContain(ROOM_PLAY_LABELS.skip);
    expect(labels).toContain(ROOM_PLAY_LABELS.hint);
    expect(labels).toContain(ROOM_PLAY_LABELS.challenge);
  });

  it('falls back to a Skip-only panel for a type with no panel', async () => {
    await atDoor();
    override = (state) => ({
      ...state,
      finalDoor: {
        ...state.finalDoor,
        slots: state.finalDoor.slots.map((s, i) => (i === 0 ? { ...s, currentQuestionType: 'bone-ordering' } : s)),
      },
    });
    act(() => binding.dispatch({ type: 'enterFinalDoor' }));
    act(() => mount.container.querySelector<HTMLButtonElement>('.final-door__seal-button')?.click());
    const panel = mount.container.querySelector('.unplayable-panel');
    expect(panel?.textContent).toContain(ROOM_PLAY_LABELS.unplayableType);
    const buttons = panel?.querySelectorAll('button') ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe(ROOM_PLAY_LABELS.skip);
    const firstId = binding.state?.finalDoor.slots[0]?.slotId;
    act(() => buttons[0]?.click());
    expect(binding.state?.finalDoor.slots.find((s) => s.slotId === firstId)?.status).toBe('settled');
  });
});

describe('FinalDoor escaped', () => {
  const mount = useMount();

  it('shows the escape message and one Open the Autopsy button, and no controls', () => {
    let opened = 0;
    mount.render(createElement(FinalDoor, { escaped: true, onOpenAutopsy: () => (opened += 1) }));
    const view = mount.container.querySelector('[data-testid="escape-view"]');
    expect(view?.textContent).toContain(ESCAPE_COPY.message);
    const buttons = mount.container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe(ROOM_PLAY_LABELS.openAutopsy);
    expect(mount.container.querySelector('.final-door__seal-button')).toBeNull();
    expect(mount.container.querySelector('[data-testid="panel-slot"]')).toBeNull();
    expect(mount.container.querySelector('.question-panel')).toBeNull();
    const text = buttons[0]?.textContent ?? '';
    expect(text).not.toBe(ROOM_PLAY_LABELS.skip);
    act(() => buttons[0]?.click());
    expect(opened).toBe(1);
  });
});
