import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, useState } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { apply, buildHumanHeartSampleCrypt, initial, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type {
  CryptManifest,
  Event,
  HumanHeartQuestionsFile,
  LockSlotState,
  SampleCryptResult,
  State,
} from '@escape-the-crypt/core';
import { stepBinding } from '../../state/room-binding-model';
import type { BindingModel } from '../../state/room-binding-model';
import { buildFirstQuestionByConcept } from '../../state/room-assets';
import type { RoomAssets } from '../../state/room-assets';
import type { RoomAction } from '../../state/room-actions';
import { buttonByText, useMount } from '../../test-support/flow-dom';
import { returnSlotName } from './accessible-names';
import { RoomPanel, keyOptionIdFor } from './room-panel';
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

/**
 * The sample has one room of two locks, too few judged answers for a ghost to come due inside it.
 * This test crypt moves two reserved final-door questions into a second room so the ghosts from
 * room 1 return there. Everything else runs through the real runtime.
 */
function twoRoomManifest(): CryptManifest {
  const m = CRYPT.manifest;
  const first = m.finalDoor.slots[0];
  const second = m.finalDoor.slots[1];
  const room1 = m.rooms[0];
  if (first === undefined || second === undefined || room1 === undefined) throw new Error('sample shape changed');
  const slotFor = (s: typeof first, index: number): LockSlotSpec => ({
    slotId: `t-slot-${index}`,
    stationType: s.question.lockType,
    conceptId: s.conceptId,
    primaryQuestion: s.question,
    alternateQuestion: null,
  });
  return {
    ...m,
    rooms: [room1, { roomId: 't-room-2', lockSlots: [slotFor(first, 1), slotFor(second, 2)] }],
    finalDoor: { slots: m.finalDoor.slots.slice(2) },
  };
}

type LockSlotSpec = CryptManifest['rooms'][number]['lockSlots'][number];
type RoomState = State['rooms'][number];

const MANIFEST = twoRoomManifest();
const ASSETS: RoomAssets = {
  content: CRYPT.content,
  chunks: CRYPT.chunks,
  firstQuestionByConcept: buildFirstQuestionByConcept(MANIFEST),
};

function startModel(): BindingModel {
  let state = initial(MANIFEST, { length: 'short', difficulty: 'apprentice', hintAllowance: 2 });
  const log: Event[] = [];
  for (const event of [
    { kind: 'RunStarted', manifestId: MANIFEST.manifestId },
    { kind: 'RoomPublished', roomId: 'hh-room-1' },
    { kind: 'RoomPublished', roomId: 't-room-2' },
    { kind: 'CryptFinalised', finalRoomCount: 2 },
    { kind: 'RoomEntered', roomId: 'hh-room-1' },
  ] satisfies Event[]) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`start event rejected: ${event.kind}`);
    state = result.state;
    log.push(event);
  }
  return { manifest: MANIFEST, eventLog: log, state, notices: [], rejection: null };
}

let model: BindingModel = startModel();
let setModel: (next: BindingModel) => void = () => undefined;
let dispatched: RoomAction[] = [];

function dispatchAction(action: RoomAction): void {
  if (action.type === 'startRun' || action.type === 'playAgain') return;
  dispatched.push(action);
  act(() => setModel(stepBinding(model, action)));
}

function Harness(): ReactNode {
  const [value, set] = useState<BindingModel>(model);
  model = value;
  setModel = (next) => {
    model = next;
    set(next);
  };
  return createElement(RoomScreen, {
    state: value.state,
    dispatch: dispatchAction,
    notices: value.notices,
    renderPanel: (slot, controls) =>
      createElement(RoomPanel, {
        slot,
        state: value.state,
        assets: ASSETS,
        rejection: value.rejection,
        eventLog: value.eventLog,
        dispatch: dispatchAction,
        openerRef: controls.openerRef,
        onClose: controls.onClose,
      }),
  });
}

function currentRoom(): RoomState {
  const room = model.state.rooms.find((r) => r.roomId === model.state.currentRoomId);
  if (room === undefined) throw new Error('no current room');
  return room;
}

/** A submission the judge marks wrong, for the slot's current question. */
function wrongSubmission(slot: LockSlotState): unknown {
  if (slot.currentQuestionType !== 'seance-board') return { text: 'zzzz-not-an-answer' };
  const key = keyOptionIdFor(model.state, slot.currentQuestionId);
  const wrong = Object.keys(CRYPT.content.questions[slot.currentQuestionId]?.options ?? {}).find((id) => id !== key);
  if (wrong === undefined) throw new Error('no wrong option');
  return { selectedOptionId: wrong };
}

function answerAllLocksWrong(): void {
  for (const lock of currentRoom().lockSlots) {
    const slot = currentRoom().lockSlots.find((s) => s.slotId === lock.slotId);
    if (slot === undefined || slot.status !== 'open') continue;
    dispatchAction({ type: 'openLock', slotId: slot.slotId });
    dispatchAction({ type: 'submitAnswer', slotId: slot.slotId, submission: wrongSubmission(slot) });
    dispatchAction({ type: 'continueEvidence', slotId: slot.slotId });
  }
}

/** Wrong answers in room 1 spawn ghosts; room 2's answers make the first one due there. */
function driveUntilReturnDue(): void {
  answerAllLocksWrong();
  if (!currentRoom().cleared) throw new Error('room 1 should be cleared');
  dispatchAction({ type: 'enterRoom', roomId: 't-room-2' });
  answerAllLocksWrong();
}
describe('Return_Slot controls', () => {
  const mount = useMount();

  function setup(): void {
    dispatched = [];
    model = startModel();
    mount.render(createElement(Harness));
  }

  it('shows no return buttons before a ghost is due', () => {
    setup();
    expect(mount.container.querySelector('[data-testid="return-slots"]')).toBeNull();
  });

  it('names a due return button as a returning question and opens the panel, leaving locks unchanged', () => {
    setup();
    driveUntilReturnDue();
    const slot = currentRoom().dueReturnSlots[0];
    if (slot === undefined) throw new Error('no return slot became due');
    const locksBefore = JSON.stringify(currentRoom().lockSlots);

    const button = mount.container.querySelector<HTMLButtonElement>('.room-screen__return-button');
    expect(button).not.toBeNull();
    const expected = returnSlotName(slot.label === 'review', 'open');
    expect(button?.getAttribute('aria-label')).toBe(expected);
    expect(expected).toContain('Returning question');
    if (slot.label === 'review') expect(expected).toContain('Review');

    button?.focus();
    act(() => button?.click());
    expect(dispatched.at(-1)).toEqual({ type: 'openLock', slotId: slot.slotId });
    expect(mount.container.querySelector('.question-panel')).not.toBeNull();
    const names = Array.from(mount.container.querySelectorAll('button')).map((b) => b.textContent);
    for (const label of [ROOM_PLAY_LABELS.skip, ROOM_PLAY_LABELS.challenge]) expect(names).toContain(label);
    expect(JSON.stringify(currentRoom().lockSlots)).toBe(locksBefore);
  });

  it('answers a return slot through the real runtime and shows the evidence panel', () => {
    setup();
    driveUntilReturnDue();
    const slot = currentRoom().dueReturnSlots[0];
    if (slot === undefined) throw new Error('no return slot became due');
    const candlesBefore = model.state.candleCount;

    act(() => mount.container.querySelector<HTMLButtonElement>('.room-screen__return-button')?.click());
    const input = mount.container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    if (input !== null) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        setter?.call(input, 'zzzz-not-an-answer');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } else {
      const wrong = Array.from(mount.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))[0];
      act(() => wrong?.click());
    }
    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.submitAnswer).click());

    const after = currentRoom().dueReturnSlots.find((s) => s.slotId === slot.slotId);
    expect(after?.status).not.toBe('open');
    expect(after?.evidencePanelOpen).toBe(true);
    expect(mount.container.querySelector('.evidence-panel')).not.toBeNull();
    expect(model.state.candleCount).toBeGreaterThanOrEqual(candlesBefore);

    act(() => buttonByText(mount.container, ROOM_PLAY_LABELS.continue).click());
    expect(mount.container.querySelector('.evidence-panel')).toBeNull();
  });
});
