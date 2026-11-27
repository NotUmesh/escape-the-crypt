import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { RoomPanel } from './room-panel';
import { failedSceneLoader, flushScene } from '../../test-support/scene-fixtures';
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

function Harness(): ReactNode {
  binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
  const { state, assets } = binding;
  if (state === null || assets === null) return null;
  return createElement(RoomScreen, {
    loadSceneImpl: failedSceneLoader,
    state,
    dispatch: binding.dispatch,
    notices: binding.notices,
    renderPanel: (slot, controls) =>
      createElement(RoomPanel, {
        slot,
        state,
        assets,
        rejection: binding.rejection,
        eventLog: binding.eventLog,
        dispatch: binding.dispatch,
        openerRef: controls.openerRef,
        onClose: controls.onClose,
      }),
  });
}

async function setup(mount: ReturnType<typeof useMount>): Promise<void> {
  mount.render(createElement(Harness));
  act(() => binding.dispatch({ type: 'startRun' }));
  await flushScene();
}

function firstSlot(): { slotId: string; status: string; currentQuestionId: string } {
  const slot = binding.state?.rooms[0]?.lockSlots[0];
  if (slot === undefined) throw new Error('no slot');
  return slot;
}

function type(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openFirst(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('.room-screen__lock-button');
  if (button === null) throw new Error('no lock button');
  button.focus();
  act(() => button.click());
  return button;
}

describe('sealCracked in the room screen', () => {
  const mount = useMount();

  it('open slot: shows the Alternate, clears the draft and focuses the panel heading', async () => {
    await setup(mount);
    openFirst(mount.container);
    const firstQuestion = firstSlot().currentQuestionId;
    type(mount.container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, 'half-typed');

    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.challenge).click());

    const slot = firstSlot();
    expect(binding.notices.some((n) => n.kind === 'sealCracked')).toBe(true);
    expect(slot.status).toBe('open');
    expect(slot.currentQuestionId).not.toBe(firstQuestion);
    const heading = mount.container.querySelector('.question-panel__heading');
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    const typed = Array.from(mount.container.querySelectorAll('input[type="text"]'));
    for (const input of typed) expect((input as HTMLInputElement).value).toBe('');
  });

  it('challenged slot: closes the panel and shows the challenged label on that lock', async () => {
    await setup(mount);
    const opener = openFirst(mount.container);
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.challenge).click());
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.challenge).click());

    expect(firstSlot().status).toBe('challenged');
    expect(binding.notices.some((n) => n.kind === 'sealCracked')).toBe(true);
    expect(mount.container.querySelector('.question-panel')).toBeNull();
    expect(mount.container.querySelector('.room-screen__challenged')?.textContent).toBe(
      ROOM_PLAY_LABELS.challengedLabel,
    );
    expect(document.activeElement).toBe(opener);
  });
});
