import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt, ROOM_ANNOUNCEMENT_COPY, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import type { RoomAction } from '../../state/room-actions';
import { buttonByText, clickButton, useMount } from '../../test-support/flow-dom';
import { announcementsFor } from './announcements';
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

const calls = vi.mocked(announcementsFor);

describe('CryptFlow escape evidence', () => {
  const mount = useMount();

  beforeEach(() => {
    calls.mockClear();
  });
  it('keeps the escaping answer\'s Evidence_Panel until a local Continue, then shows the escape view; playAgain resets', async () => {
    const dispatched: RoomAction[] = [];
    mount.render(
      flow(() => {
        const real = realBinding();
        return {
          ...real,
          dispatch: (action: RoomAction) => {
            dispatched.push(action);
            real.dispatch(action);
          },
        };
      }),
    );
    const region = (): string => mount.container.querySelector('[data-testid="room-live-region"]')?.textContent ?? '';

    async function reachLastDoorAnswer(): Promise<void> {
      if (binding.state?.status !== 'in progress') send({ type: 'startRun' });
      // Skip every room slot, enter the door and skip all but its last open seal.
      for (let guard = 0; guard < 100; guard += 1) {
        const state = binding.state;
        if (state === null || state.atFinalDoor) break;
        const [slotId] = openSlotIds(state);
        if (slotId !== undefined) {
          send({ type: 'skip', slotId });
          if (binding.rejection !== null) {
            send({ type: 'openLock', slotId });
            send({ type: 'skip', slotId });
          }
        } else if (state.finalDoor.available) {
          send({ type: 'enterFinalDoor' });
        } else break;
      }
      const door = binding.state;
      if (door === null || !door.atFinalDoor) throw new Error('not at the final door');
      const open = openSlotIds(door);
      for (const slotId of open.slice(0, -1)) send({ type: 'skip', slotId });
      expect(binding.state?.status).toBe('in progress');

      // Answer the last seal correctly through the UI.
      const slot = binding.state?.finalDoor.slots.find((s) => s.status === 'open');
      if (slot === undefined) throw new Error('no open door slot');
      const seal = mount.container.querySelector<HTMLButtonElement>('.final-door__seal-button');
      if (seal === null) throw new Error('no seal button');
      await act(async () => seal.click());
      // The last seal can be a returning question, so look through every question in the manifest.
      const questions = [
        ...CRYPT.manifest.rooms.flatMap((r) => r.lockSlots.flatMap((s) => [s.primaryQuestion, s.alternateQuestion])),
        ...CRYPT.manifest.finalDoor.slots.map((s) => s.question),
      ];
      const spec = questions.find((q) => q?.questionId === slot.currentQuestionId);
      const payload = spec?.payload as { answer?: string; keyOptionId?: string } | undefined;
      if (payload?.answer !== undefined) {
        const text = mount.container.querySelector<HTMLInputElement>('.rune-cipher-panel input[type="text"]');
        if (text === null) throw new Error('no answer input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        await act(async () => {
          setter?.call(text, payload.answer);
          text.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } else {
        const radio = mount.container.querySelector<HTMLInputElement>(`input[type="radio"][value="${payload?.keyOptionId}"]`);
        if (radio === null) {
          throw new Error(
            `no answer for ${slot.currentQuestionId}`,
          );
        }
        await act(async () => radio.click());
      }
      await clickButton(mount.container, ROOM_PLAY_LABELS.submitAnswer);
    }

    await reachLastDoorAnswer();
    expect(binding.state?.status).toBe('escaped');

    // The escaping answer's Evidence_Panel stays, with its excerpt and Citation_Label; no escape view yet.
    const panel = mount.container.querySelector<HTMLElement>('.evidence-panel');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('.evidence-panel__excerpt blockquote')?.textContent?.length).toBeGreaterThan(0);
    expect(panel?.querySelector('.evidence-panel__citation')?.textContent).toMatch(/^Paragraph \d+ of the sample notes$/);
    expect(mount.container.querySelector('[data-testid="escape-view"]')).toBeNull();
    expect(document.activeElement).toBe(panel);
    // Only Continue is offered: no hint, skip, challenge or answer control.
    expect(Array.from(mount.container.querySelectorAll('button')).map((b) => b.textContent)).toEqual([ROOM_PLAY_LABELS.continue]);
    expect(mount.container.querySelector('input')).toBeNull();
    const escapedAnnouncement = region();
    const escapedAnnounced = (): number =>
      calls.mock.results
        .flatMap((r) => (r.value as readonly string[]) ?? [])
        .filter((m) => m === ROOM_ANNOUNCEMENT_COPY.notice.escaped).length;
    expect(escapedAnnounced()).toBe(1);

    // Continue closes the panel locally: no Event is dispatched and the event log is unchanged.
    const dispatchedBefore = dispatched.length;
    const logBefore = binding.eventLog;
    const logLength = logBefore.length;
    await clickButton(mount.container, ROOM_PLAY_LABELS.continue);
    expect(dispatched.length).toBe(dispatchedBefore);
    expect(binding.eventLog).toBe(logBefore);
    expect(binding.eventLog).toHaveLength(logLength);
    expect(binding.rejection).toBeNull();

    expect(mount.container.querySelector('.evidence-panel')).toBeNull();
    expect(mount.container.querySelector('[data-testid="escape-view"]')).not.toBeNull();
    expect(document.activeElement).toBe(buttonByText(mount.container, ROOM_PLAY_LABELS.openAutopsy));
    expect(region()).toBe(escapedAnnouncement);
    expect(escapedAnnounced()).toBe(1);

    // playAgain resets the flag: a second escaping answer shows its Evidence_Panel again.
    await clickButton(mount.container, ROOM_PLAY_LABELS.openAutopsy);
    await act(async () => buttonByText(mount.container, ROOM_PLAY_LABELS.playAgain).click());
    expect(binding.state?.status).toBe('in progress');
    await reachLastDoorAnswer();
    expect(binding.state?.status).toBe('escaped');
    expect(mount.container.querySelector('.evidence-panel')).not.toBeNull();
    expect(mount.container.querySelector('[data-testid="escape-view"]')).toBeNull();
  });
});
