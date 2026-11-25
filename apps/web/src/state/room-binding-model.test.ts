import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, buildHumanHeartSampleCrypt, initial } from '@escape-the-crypt/core';
import type { CryptManifest, Event, HumanHeartQuestionsFile, State } from '@escape-the-crypt/core';
import type { EventRoomAction } from './room-actions';
import { stepBinding } from './room-binding-model';
import type { BindingModel } from './room-binding-model';

function loadManifest(): CryptManifest {
  // Vitest runs with apps/web as the working directory.
  const root = join(process.cwd(), '..', '..', 'samples');
  const notes = readFileSync(join(root, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(
    readFileSync(join(root, 'questions', 'human-heart.json'), 'utf8'),
  ) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  if (!built.ok) throw new Error(`sample crypt failed: ${built.error.kind}`);
  return built.value.manifest;
}

const MANIFEST = loadManifest();
const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 2 } as const;

function startEvents(manifest: CryptManifest): readonly Event[] {
  const firstRoom = manifest.rooms[0]?.roomId ?? '';
  return [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: firstRoom },
    { kind: 'CryptFinalised', finalRoomCount: manifest.rooms.length },
    { kind: 'RoomEntered', roomId: firstRoom },
  ];
}

function fold(manifest: CryptManifest, events: readonly Event[]): State {
  let state = initial(manifest, SETTINGS);
  for (const event of events) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`fold rejected ${event.kind}: ${result.error.kind}`);
    state = result.state;
  }
  return state;
}

function startedModel(): BindingModel {
  const events = startEvents(MANIFEST);
  return { manifest: MANIFEST, eventLog: events, state: fold(MANIFEST, events), notices: [], rejection: null };
}

const slots = MANIFEST.rooms.flatMap((r) => r.lockSlots);
const slotId = slots[0]?.slotId ?? '';
const runeSlot = slots.find((s) => s.primaryQuestion.lockType === 'rune-cipher');

describe('stepBinding', () => {
  it('accepted: appends one Event, replaces state and clears rejection', () => {
    const rejected = stepBinding(startedModel(), { type: 'openLock', slotId: 'no-such-slot' });
    expect(rejected.rejection).not.toBeNull();
    const next = stepBinding(rejected, { type: 'openLock', slotId });
    expect(next.rejection).toBeNull();
    expect(next.eventLog).toEqual([...rejected.eventLog, { kind: 'LockOpened', slotId }]);
    expect(next.state).not.toBe(rejected.state);
  });

  it('rejected: leaves log and state unchanged and sets rejection', () => {
    const model = startedModel();
    const next = stepBinding(model, { type: 'openLock', slotId: 'no-such-slot' });
    expect(next.eventLog).toBe(model.eventLog);
    expect(next.state).toBe(model.state);
    expect(next.rejection).not.toBeNull();
  });

  it('replaces notices rather than accumulating them', () => {
    const id = runeSlot?.slotId ?? '';
    expect(runeSlot).toBeDefined();
    let model = stepBinding(startedModel(), { type: 'openLock', slotId: id });
    model = stepBinding(model, { type: 'submitAnswer', slotId: id, submission: { text: 'zzz-not-the-answer' } });
    expect(model.rejection).toBeNull();
    const before = model;
    const next = stepBinding(before, { type: 'continueEvidence', slotId: id });
    const direct = apply(before.state, { kind: 'EvidenceContinued', slotId: id });
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(next.notices).toEqual(direct.notices);
  });
  it('rejected after an accepted action with notices: notices cleared, log and state kept', () => {
    const id = runeSlot?.slotId ?? '';
    let model = stepBinding(startedModel(), { type: 'openLock', slotId: id });
    model = stepBinding(model, { type: 'submitAnswer', slotId: id, submission: { text: 'zzz-not-the-answer' } });
    expect(model.rejection).toBeNull();
    expect(model.notices.length).toBeGreaterThan(0);
    const next = stepBinding(model, { type: 'openLock', slotId: 'no-such-slot' });
    expect(next.notices).toEqual([]);
    expect(next.rejection).not.toBeNull();
    expect(next.eventLog).toBe(model.eventLog);
    expect(next.state).toBe(model.state);
  });

  it('keeps Draft_Answer values out of the model (only the model fields exist)', () => {
    expect(Object.keys(startedModel()).sort()).toEqual(['eventLog', 'manifest', 'notices', 'rejection', 'state']);
  });

  // Feature: room-play, Property 1: The binding's state is the fold of its accepted events
  // **Validates: Requirements 4.3, 4.5, 4.6**
  it('Property 1: the binding state is the fold of its accepted events', () => {
    const slotIds = [...slots.map((s) => s.slotId), ...MANIFEST.finalDoor.slots.map((s) => s.slotId), 'unknown'];
    const roomIds = [...MANIFEST.rooms.map((r) => r.roomId), 'unknown'];
    const slotArb = fc.constantFrom(...slotIds);
    const submissionArb = fc.oneof(
      fc.record({ text: fc.string() }),
      fc.record({ selectedOptionId: fc.constantFrom('a', 'b', 'c', 'opt') }),
      fc.anything(),
    );
    const actionArb: fc.Arbitrary<EventRoomAction> = fc.oneof(
      fc.record({ type: fc.constant('enterRoom' as const), roomId: fc.constantFrom(...roomIds) }),
      fc.record({ type: fc.constant('openLock' as const), slotId: slotArb }),
      fc.record({ type: fc.constant('useHint' as const), slotId: slotArb }),
      fc.record({ type: fc.constant('submitAnswer' as const), slotId: slotArb, submission: submissionArb }),
      fc.record({ type: fc.constant('skip' as const), slotId: slotArb }),
      fc.record({ type: fc.constant('challenge' as const), slotId: slotArb }),
      fc.record({ type: fc.constant('continueEvidence' as const), slotId: slotArb }),
      fc.constant({ type: 'enterFinalDoor' as const }),
    );
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        let model = startedModel();
        for (const action of actions) {
          const before = model;
          model = stepBinding(model, action);
          if (model.rejection !== null) {
            expect(model.eventLog).toBe(before.eventLog);
            expect(model.state).toBe(before.state);
          } else {
            expect(model.eventLog.length).toBe(before.eventLog.length + 1);
          }
        }
        expect(model.state).toEqual(fold(MANIFEST, model.eventLog));
      }),
      { numRuns: 100 },
    );
  });
});
