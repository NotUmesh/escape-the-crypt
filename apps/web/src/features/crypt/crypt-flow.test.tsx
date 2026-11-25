import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHumanHeartSampleCrypt,
  ENTER_CRYPT_LABEL,
  ESCAPE_COPY,
  ROOM_PLAY_LABELS,
  ROOM_START_ERROR_COPY,
  SAMPLE_CRYPT_LABEL,
} from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptError, SampleCryptResult, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import type { RoomAction } from '../../state/room-actions';
import { buttonByText, clickButton, useMount } from '../../test-support/flow-dom';
import { announcementsFor } from './announcements';
import { CryptErrorBoundary } from './crypt-error-boundary';
import { CryptFlow } from './crypt-flow';

vi.mock('./announcements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./announcements')>();
  return { ...actual, announcementsFor: vi.fn(actual.announcementsFor) };
});

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

function realBinding(): RoomBinding {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  return binding;
}

function flow(useBinding: () => RoomBinding = realBinding): ReactNode {
  return createElement(CryptFlow, { useBinding });
}

function send(action: RoomAction): void {
  act(() => binding.dispatch(action));
}

function openSlotIds(state: State): string[] {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const slots = state.atFinalDoor
    ? state.finalDoor.slots
    : [...(room?.lockSlots ?? []), ...(room?.dueReturnSlots ?? [])];
  return slots.filter((s) => s.status === 'open').map((s) => s.slotId);
}

/** Plays the real runtime to the escape by skipping every open slot and entering the final door. */
function playToEscape(): void {
  for (let guard = 0; guard < 100 && binding.state?.status === 'in progress'; guard += 1) {
    const state = binding.state;
    const [slotId] = openSlotIds(state);
    if (slotId !== undefined) {
      send({ type: 'skip', slotId });
      if (binding.rejection !== null) {
        send({ type: 'openLock', slotId });
        send({ type: 'skip', slotId });
      }
    } else if (state.finalDoor.available && !state.atFinalDoor) {
      send({ type: 'enterFinalDoor' });
    } else {
      break;
    }
  }
  if (binding.state?.status !== 'escaped') throw new Error('did not reach the escape');
}

const calls = vi.mocked(announcementsFor);

describe('CryptFlow', () => {
  const mount = useMount();

  beforeEach(() => {
    calls.mockClear();
  });

  it('shows the start view first and enters the room on "Enter the crypt"', async () => {
    mount.render(flow());
    expect(mount.container.querySelector('.crypt-start')).not.toBeNull();
    expect(mount.container.querySelector('.room-screen')).toBeNull();
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();
    expect(mount.container.textContent).toContain(SAMPLE_CRYPT_LABEL);
  });

  it('shows the start-failed message from ROOM_START_ERROR_COPY and starts no run', async () => {
    const error: SampleCryptError = { kind: 'concept-label-missing', questionId: 'hh-q01', conceptId: 'c1' };
    mount.render(
      flow(() => {
        binding = useRoomBinding(() => ({ ok: false, error }));
        return binding;
      }),
    );
    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    const copy = ROOM_START_ERROR_COPY['concept-label-missing'];
    const text = mount.container.querySelector('[data-testid="start-failed"]')?.textContent ?? '';
    expect(text).toContain(copy.what);
    expect(text).toContain(copy.next);
    expect(mount.container.querySelector('.room-screen')).toBeNull();
  });

  it('uses the start-rejected copy for a rejected start Event', () => {
    const fake: RoomBinding = {
      phase: 'start-failed',
      state: null,
      eventLog: [],
      assets: null,
      notices: [],
      rejection: null,
      startError: { kind: 'run-finished' },
      dispatch: () => undefined,
    };
    mount.render(flow(() => fake));
    expect(mount.container.textContent).toContain(ROOM_START_ERROR_COPY['start-rejected'].what);
  });

  it('routes the final door while atFinalDoor and the escape view, then the Autopsy only on request', () => {
    mount.render(flow());
    send({ type: 'startRun' });
    // Skip every lock until the door is available, then stop before entering it.
    for (let guard = 0; guard < 50; guard += 1) {
      const state = binding.state;
      if (state === null || state.finalDoor.available) break;
      const [slotId] = openSlotIds(state);
      if (slotId === undefined) break;
      send({ type: 'skip', slotId });
      if (binding.rejection !== null) {
        send({ type: 'openLock', slotId });
        send({ type: 'skip', slotId });
      }
    }
    expect(binding.state?.finalDoor.available).toBe(true);
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();

    send({ type: 'enterFinalDoor' });
    if (binding.state?.status === 'in progress') {
      expect(mount.container.querySelector('[data-testid="final-door"]')).not.toBeNull();
      expect(mount.container.querySelector('.room-screen')).toBeNull();
    }
    playToEscape();
    expect(mount.container.querySelector('[data-testid="escape-view"]')).not.toBeNull();
    expect(mount.container.textContent).toContain(ESCAPE_COPY.message);
    expect(mount.container.querySelector('[data-testid="autopsy-view"]')).toBeNull();
  });

  it('sets the Autopsy flag from the escape view and clears it on playAgain', async () => {
    mount.render(flow());
    send({ type: 'startRun' });
    playToEscape();
    expect(mount.container.querySelector('[data-testid="autopsy-view"]')).toBeNull();

    await clickButton(mount.container, ROOM_PLAY_LABELS.openAutopsy);
    expect(mount.container.querySelector('[data-testid="autopsy-view"]')).not.toBeNull();
    expect(mount.container.querySelector('[data-testid="escape-view"]')).toBeNull();

    await act(async () => buttonByText(mount.container, ROOM_PLAY_LABELS.playAgain).click());
    expect(binding.state?.status).toBe('in progress');
    expect(mount.container.querySelector('[data-testid="autopsy-view"]')).toBeNull();
    expect(mount.container.querySelector('.room-screen')).not.toBeNull();

    // A second escape shows the escape view again, not the Autopsy: the flag really was cleared.
    playToEscape();
    expect(mount.container.querySelector('[data-testid="escape-view"]')).not.toBeNull();
    expect(mount.container.querySelector('[data-testid="autopsy-view"]')).toBeNull();
  });

  it('feeds announcements once per accepted dispatch and none for a rejected one', () => {
    mount.render(flow());
    send({ type: 'startRun' });
    expect(calls).not.toHaveBeenCalled();
    const region = (): string => mount.container.querySelector('[data-testid="room-live-region"]')?.textContent ?? '';
    expect(region()).toBe('');

    send({ type: 'enterFinalDoor' });
    expect(binding.rejection).not.toBeNull();
    expect(calls).not.toHaveBeenCalled();
    expect(region()).toBe('');

    const state = binding.state;
    const slotId = state === null ? undefined : openSlotIds(state)[0];
    if (slotId === undefined) throw new Error('no open slot');
    send({ type: 'openLock', slotId });
    const afterOpen = calls.mock.calls.length;
    expect(afterOpen).toBe(1);
    send({ type: 'skip', slotId });
    expect(calls.mock.calls.length).toBe(2);
    const latest = calls.mock.results[1]?.value as readonly string[];
    expect(latest.length).toBeGreaterThan(0);
    expect(region()).toBe(latest[0]);

    send({ type: 'enterFinalDoor' });
    expect(calls.mock.calls.length).toBe(2);
  });
});

describe('CryptErrorBoundary', () => {
  const mount = useMount();

  it('logs only the error name and component stack, never the message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): ReactNode {
      throw new TypeError('secret note text');
    }
    mount.render(createElement(CryptErrorBoundary, null, createElement(Boom)));
    const ours = spy.mock.calls.filter((c) => c[0] === 'crypt-flow error');
    spy.mockRestore();
    expect(ours).toHaveLength(1);
    expect(ours[0]?.[1]).toBe('TypeError');
    expect(JSON.stringify(ours[0])).not.toContain('secret note text');
    expect(mount.container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
