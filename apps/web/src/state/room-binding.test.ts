import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHumanHeartSampleCrypt } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptError, SampleCryptResult } from '@escape-the-crypt/core';
import { useRoomBinding } from './room-binding';
import type { BuildCrypt, RoomBinding } from './room-binding';
import { chosenOptionFor } from './room-selectors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
const okBuild: BuildCrypt = () => ({ ok: true, value: CRYPT });

let root: Root;
let current: RoomBinding;

function Probe({ buildCrypt }: { readonly buildCrypt: BuildCrypt }): null {
  current = useRoomBinding(buildCrypt);
  return null;
}

function mount(buildCrypt: BuildCrypt): void {
  act(() => {
    root.render(createElement(Probe, { buildCrypt }));
  });
}

beforeEach(() => {
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
});

const firstSlot = CRYPT.manifest.rooms[0]?.lockSlots[0];
const slotId = firstSlot?.slotId ?? '';
const roomId = CRYPT.manifest.rooms[0]?.roomId ?? '';

describe('useRoomBinding start', () => {
  it('is not started with an empty log before startRun', () => {
    mount(okBuild);
    expect(current.phase).toBe('not-started');
    expect(current.state).toBeNull();
    expect(current.assets).toBeNull();
    expect(current.eventLog).toEqual([]);
  });

  it('applies the four start Events in order with the default settings', () => {
    mount(okBuild);
    act(() => current.dispatch({ type: 'startRun' }));
    expect(current.phase).toBe('running');
    expect(current.eventLog).toEqual([
      { kind: 'RunStarted', manifestId: CRYPT.manifest.manifestId },
      { kind: 'RoomPublished', roomId },
      { kind: 'CryptFinalised', finalRoomCount: 1 },
      { kind: 'RoomEntered', roomId },
    ]);
    // Short and Apprentice: the Apprentice starts with 3 hints (Requirement 5.1).
    expect(current.state?.settings).toEqual({ length: 'short', difficulty: 'apprentice', hintAllowance: 3 });
    expect(current.startError).toBeNull();
  });

  it('builds the crypt once per startRun and passes it no notes text', () => {
    let calls = 0;
    mount(() => {
      calls += 1;
      return { ok: true, value: CRYPT };
    });
    act(() => current.dispatch({ type: 'startRun' }));
    expect(calls).toBe(1);
  });

  it('sets start-failed and starts no run when buildCrypt errors', () => {
    const error: SampleCryptError = { kind: 'concept-label-missing', questionId: 'hh-q01', conceptId: 'c1' };
    mount(() => ({ ok: false, error }));
    act(() => current.dispatch({ type: 'startRun' }));
    expect(current.phase).toBe('start-failed');
    expect(current.startError).toEqual(error);
    expect(current.state).toBeNull();
    expect(current.assets).toBeNull();
    expect(current.eventLog).toEqual([]);
  });

  it('sets start-failed when a start Event is rejected', () => {
    // An empty rooms list makes RoomPublished name a room that does not exist.
    const broken: SampleCryptResult = { ...CRYPT, manifest: { ...CRYPT.manifest, rooms: [] } };
    mount(() => ({ ok: true, value: broken }));
    act(() => current.dispatch({ type: 'startRun' }));
    expect(current.phase).toBe('start-failed');
    expect(current.startError).not.toBeNull();
    expect(current.state).toBeNull();
    expect(current.eventLog).toEqual([]);
  });
});

describe('useRoomBinding play', () => {
  it('playAgain empties the log and keeps the same assets reference', () => {
    mount(okBuild);
    act(() => current.dispatch({ type: 'startRun' }));
    const assets = current.assets;
    const firstQuestionByConcept = current.assets?.firstQuestionByConcept;
    expect(assets).not.toBeNull();
    expect(Object.keys(firstQuestionByConcept ?? {}).length).toBeGreaterThan(0);
    act(() => current.dispatch({ type: 'openLock', slotId }));
    expect(current.eventLog).toHaveLength(5);
    act(() => current.dispatch({ type: 'playAgain' }));
    expect(current.phase).toBe('running');
    expect(current.eventLog).toHaveLength(4);
    expect(current.eventLog.map((e) => e.kind)).toEqual([
      'RunStarted',
      'RoomPublished',
      'CryptFinalised',
      'RoomEntered',
    ]);
    expect(current.assets).toBe(assets);
    expect(current.assets?.firstQuestionByConcept).toBe(firstQuestionByConcept);
    expect(current.assets?.content).toBe(CRYPT.content);
    expect(current.assets?.chunks).toBe(CRYPT.chunks);
  });

  it('playAgain before any run does nothing', () => {
    mount(okBuild);
    act(() => current.dispatch({ type: 'playAgain' }));
    expect(current.phase).toBe('not-started');
  });

  it('keeps drafts out of the log: only a submitAnswer carries an answer', () => {
    mount(okBuild);
    act(() => current.dispatch({ type: 'startRun' }));
    act(() => current.dispatch({ type: 'openLock', slotId }));
    expect(current.eventLog.some((e) => e.kind === 'AnswerSubmitted')).toBe(false);
    act(() => current.dispatch({ type: 'submitAnswer', slotId, submission: { text: 'zzz' } }));
    const submitted = current.eventLog.filter((e) => e.kind === 'AnswerSubmitted');
    expect(submitted).toHaveLength(1);
    expect(JSON.stringify(current)).not.toContain('draft');
  });

  it('records a rejection without changing the log or state', () => {
    mount(okBuild);
    act(() => current.dispatch({ type: 'startRun' }));
    const before = current.eventLog;
    const state = current.state;
    act(() => current.dispatch({ type: 'openLock', slotId: 'no-such-slot' }));
    expect(current.rejection).not.toBeNull();
    expect(current.eventLog).toBe(before);
    expect(current.state).toBe(state);
  });

  it('leaves the confirmed notes and chunks untouched across a run', () => {
    const before = JSON.stringify([...CRYPT.chunks.entries()]);
    const content = JSON.stringify(CRYPT.content);
    mount(okBuild);
    act(() => current.dispatch({ type: 'startRun' }));
    act(() => current.dispatch({ type: 'openLock', slotId }));
    act(() => current.dispatch({ type: 'playAgain' }));
    expect(JSON.stringify([...CRYPT.chunks.entries()])).toBe(before);
    expect(JSON.stringify(CRYPT.content)).toBe(content);
  });
});

describe('useRoomBinding eventLog and chosenOptionFor', () => {
  const seanceSlot = CRYPT.manifest.rooms
    .flatMap((r) => r.lockSlots)
    .find((s) => s.primaryQuestion.lockType === 'seance-board');
  const seancePayload = seanceSlot?.primaryQuestion.payload as
    | { optionIds: string[]; keyOptionId: string }
    | undefined;

  it('grows on accepted actions, is unchanged on rejected ones, and exposes the chosen option', () => {
    expect(seanceSlot).toBeDefined();
    const seanceSlotId = seanceSlot?.slotId ?? '';
    const chosen = seancePayload?.optionIds.find((o) => o !== seancePayload.keyOptionId) ?? '';
    mount(okBuild);
    act(() => current.dispatch({ type: 'startRun' }));
    act(() => current.dispatch({ type: 'openLock', slotId: seanceSlotId }));
    const afterOpen = current.eventLog;
    expect(afterOpen).toHaveLength(5);
    expect(chosenOptionFor(afterOpen, seanceSlotId)).toBeUndefined();

    act(() => current.dispatch({ type: 'submitAnswer', slotId: seanceSlotId, submission: { selectedOptionId: chosen } }));
    const afterSubmit = current.eventLog;
    expect(afterSubmit).toHaveLength(6);
    expect(afterSubmit.at(-1)?.kind).toBe('AnswerSubmitted');
    expect(chosenOptionFor(afterSubmit, seanceSlotId)).toBe(chosen);

    act(() => current.dispatch({ type: 'openLock', slotId: 'no-such-slot' }));
    expect(current.rejection).not.toBeNull();
    expect(current.eventLog).toBe(afterSubmit);
    expect(chosenOptionFor(current.eventLog, seanceSlotId)).toBe(chosen);
  });

  it('has no chosenOptionId method on the hook', () => {
    mount(okBuild);
    expect('chosenOptionId' in current).toBe(false);
    expect('chosenOptionFor' in current).toBe(false);
  });
});
