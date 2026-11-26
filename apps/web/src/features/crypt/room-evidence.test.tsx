import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import type { RoomAction } from '../../state/room-actions';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { RoomPanel } from './room-panel';
import { RoomScreen } from './room-screen';

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
let dispatched: RoomAction[] = [];

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  const { state, assets } = binding;
  if (state === null || assets === null) return null;
  const dispatch = (action: RoomAction): void => {
    dispatched.push(action);
    binding.dispatch(action);
  };
  return createElement(RoomScreen, {
    state,
    dispatch,
    notices: binding.notices,
    renderPanel: (slot, controls) =>
      createElement(RoomPanel, {
        slot,
        state,
        assets,
        rejection: binding.rejection,
        eventLog: binding.eventLog,
        dispatch,
        openerRef: controls.openerRef,
        onClose: controls.onClose,
      }),
  });
}

function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Opens the first lock and submits a wrong text answer so the evidence panel opens. */
function openEvidence(container: HTMLElement): HTMLButtonElement {
  dispatched = [];
  const opener = container.querySelector<HTMLButtonElement>('.room-screen__lock-button');
  if (opener === null) throw new Error('no lock button');
  opener.focus();
  act(() => opener.click());
  type(container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, 'zzzz-not-an-answer');
  act(() => buttonByText(container, ROOM_PLAY_LABELS.submitAnswer).click());
  return opener;
}

describe('Evidence_Panel in the room screen', () => {
  const mount = useMount();

  function setup(): void {
    mount.render(createElement(Harness));
    act(() => binding.dispatch({ type: 'startRun' }));
  }

  it('shows the panel when the slot has evidencePanelOpen, moves focus in and hides hint, skip and challenge', () => {
    setup();
    openEvidence(mount.container);
    expect(binding.state?.rooms[0]?.lockSlots[0]?.evidencePanelOpen).toBe(true);
    const panel = mount.container.querySelector('.evidence-panel');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
    const names = Array.from(mount.container.querySelectorAll('button')).map((b) => b.textContent);
    expect(names).toContain(ROOM_PLAY_LABELS.continue);
    for (const hidden of [ROOM_PLAY_LABELS.skip, ROOM_PLAY_LABELS.challenge]) expect(names).not.toContain(hidden);
  });

  it('Continue dispatches continueEvidence, closes the panel and returns focus to the slot button', () => {
    setup();
    const opener = openEvidence(mount.container);
    const slotId = binding.state?.rooms[0]?.lockSlots[0]?.slotId;
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.continue).click());
    expect(dispatched.at(-1)).toEqual({ type: 'continueEvidence', slotId });
    expect(binding.state?.rooms[0]?.lockSlots[0]?.evidencePanelOpen).toBe(false);
    expect(mount.container.querySelector('.evidence-panel')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
