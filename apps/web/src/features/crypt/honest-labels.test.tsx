import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  BANNED_COPY_PHRASES,
  buildHumanHeartSampleCrypt,
  ENTER_CRYPT_LABEL,
  ROOM_PLAY_LABELS,
  SAMPLE_CRYPT_LABEL,
} from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { buttonByText, clickButton, useMount } from '../../test-support/flow-dom';
import { failedSceneLoader, flushScene } from '../../test-support/scene-fixtures';
import { CryptFlow } from './crypt-flow';

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
const FORBIDDEN_LABELS = ['Human-reviewed', 'Blind model review passed'];

let binding: RoomBinding;

function openSlotIds(state: State): string[] {
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const slots = state.atFinalDoor
    ? state.finalDoor.slots
    : [...(room?.lockSlots ?? []), ...(room?.dueReturnSlots ?? [])];
  return slots.filter((s) => s.status === 'open').map((s) => s.slotId);
}

describe('honest labels on every screen', () => {
  const mount = useMount();

  it('shows the sample label during the run and no forbidden label, banned phrase or "of your notes" citation', async () => {
    const snaps: { name: string; text: string; inRun: boolean }[] = [];
    const citations: string[] = [];
    const snap = (name: string, inRun = true): void => {
      snaps.push({ name, text: mount.container.textContent ?? '', inRun });
      for (const el of mount.container.querySelectorAll('.evidence-panel__citation')) {
        citations.push(el.textContent ?? '');
      }
    };
    const send = (action: Parameters<RoomBinding['dispatch']>[0], name: string): void => {
      act(() => binding.dispatch(action));
      snap(name);
    };

    /** Answers the open panel wrongly (or with the first option) so the evidence panel opens. */
    async function answer(name: string): Promise<void> {
      const text = mount.container.querySelector<HTMLInputElement>('.rune-cipher-panel input[type="text"]');
      if (text !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
          setter?.call(text, 'zzzz-not-an-answer');
          text.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } else {
        const radio = mount.container.querySelector<HTMLInputElement>('input[type="radio"]:not(:disabled)');
        if (radio !== null) await act(async () => radio.click());
      }
      await clickButton(mount.container, ROOM_PLAY_LABELS.submitAnswer);
      snap(`${name} evidence`);
      if (mount.container.querySelector('.evidence-panel') !== null) {
        await clickButton(mount.container, ROOM_PLAY_LABELS.continue);
        snap(`${name} after continue`);
      }
    }

    mount.render(
      createElement(CryptFlow, {
        loadSceneImpl: failedSceneLoader,
        useBinding: () => {
          binding = useRoomBinding(() => ({ ok: true, value: CRYPT }));
          return binding;
        },
      }),
    );
    snap('start', false);

    await clickButton(mount.container, ENTER_CRYPT_LABEL);
    snap('room');

    // Room panel and its evidence panel.
    const opener = mount.container.querySelector<HTMLButtonElement>('.room-screen__lock-button');
    if (opener === null) throw new Error('no lock button');
    await act(async () => opener.click());
    snap('room panel');
    await answer('room');

    // Skip to the final door, then open one seal for its panel and evidence.
    let answeredAtDoor = false;
    for (let guard = 0; guard < 100 && binding.state?.status === 'in progress'; guard += 1) {
      const state = binding.state;
      const [slotId] = openSlotIds(state);
      if (state.atFinalDoor && !answeredAtDoor) {
        await flushScene();
        const seal = mount.container.querySelector<HTMLButtonElement>('.final-door__seal-button');
        if (seal !== null) {
          await act(async () => seal.click());
          snap('final door panel');
          await answer('final door');
          answeredAtDoor = true;
          continue;
        }
      }
      if (slotId !== undefined) {
        send({ type: 'skip', slotId }, 'skip');
        if (binding.rejection !== null) {
          send({ type: 'openLock', slotId }, 'open');
          send({ type: 'skip', slotId }, 'skip');
        }
      } else if (state.finalDoor.available && !state.atFinalDoor) {
        send({ type: 'enterFinalDoor' }, 'final door');
      } else {
        break;
      }
    }
    expect(binding.state?.status).toBe('escaped');
    expect(answeredAtDoor).toBe(true);
    expect(mount.container.querySelector('[data-testid="escape-view"]')).not.toBeNull();
    snap('escape view');

    await act(async () => buttonByText(mount.container, ROOM_PLAY_LABELS.openAutopsy).click());
    expect(mount.container.querySelector('[data-testid="autopsy-view"]')).not.toBeNull();
    snap('autopsy');

    const names = snaps.map((s) => s.name);
    for (const required of ['room', 'room panel', 'room evidence', 'final door panel', 'final door evidence', 'escape view', 'autopsy']) {
      expect(names).toContain(required);
    }
    expect(citations.length).toBeGreaterThan(0);

    for (const { name, text, inRun } of snaps) {
      if (inRun) expect(text, `sample label on "${name}"`).toContain(SAMPLE_CRYPT_LABEL);
      for (const forbidden of FORBIDDEN_LABELS) expect(text, `"${forbidden}" on "${name}"`).not.toContain(forbidden);
      const lower = text.toLowerCase();
      for (const phrase of BANNED_COPY_PHRASES) {
        expect(lower, `banned phrase "${phrase}" on "${name}"`).not.toContain(phrase.toLowerCase());
      }
    }
    for (const label of citations) expect(label).not.toMatch(/of your notes\s*$/i);
  });
});
