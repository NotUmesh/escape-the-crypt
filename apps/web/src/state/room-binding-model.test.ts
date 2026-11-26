import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, buildHumanHeartSampleCrypt, initial } from '@escape-the-crypt/core';
import type { CryptManifest, Event, HumanHeartQuestionsFile, State } from '@escape-the-crypt/core';
import { selectFinalDoor } from '../../../../packages/core/src/runtime/selectors';
import { submissionFor } from '../../../../packages/core/src/test-support/question-answers';
import { openTargets, questionFor } from '../../../../packages/core/src/test-support/runtime-model-support';
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

// Feature: room-play, escape under four fixed policies, driven through stepBinding
// (the loop of core's test-support/escape-driver.ts, with stepBinding in place of apply).
// **Validates: Requirements 19.10, 19.11, 18.4, 18.5**
type Policy = 'all wrong' | 'all skip' | 'all challenge' | 'rotate';

function actionFor(model: BindingModel, policy: Policy, prompts: number, slot: string, questionId: string): EventRoomAction {
  const choice = policy === 'all wrong' ? 0 : policy === 'all skip' ? 1 : policy === 'all challenge' ? 2 : prompts % 3;
  if (choice === 1) return { type: 'skip', slotId: slot };
  if (choice === 2) return { type: 'challenge', slotId: slot };
  return { type: 'submitAnswer', slotId: slot, submission: submissionFor(questionFor(model.manifest, questionId), false) };
}

function playPolicy(policy: Policy): { model: BindingModel; prompts: number; budget: number } {
  let model = startedModel();
  const concepts = MANIFEST.rooms.reduce((n, r) => n + r.lockSlots.length, 0);
  // Room-runtime Requirement 20.7: (total Concepts x 4) + Reserved_Final_Door_Questions.
  const budget = concepts * 4 + MANIFEST.finalDoor.slots.length;
  let prompts = 0;
  while (model.state.status !== 'escaped') {
    const target = openTargets(model.state)[0];
    if (target !== undefined) {
      if (prompts >= budget) break;
      model = stepBinding(model, actionFor(model, policy, prompts, target.slotId, target.questionId));
      expect(model.rejection).toBeNull();
      prompts += 1;
    } else if (selectFinalDoor(model.state).available && !model.state.atFinalDoor) {
      model = stepBinding(model, { type: 'enterFinalDoor' });
      expect(model.rejection).toBeNull();
    } else {
      break;
    }
  }
  return { model, prompts, budget };
}

describe('escape through stepBinding', () => {
  for (const policy of ['all wrong', 'all skip', 'all challenge', 'rotate'] as const) {
    it(`${policy}: reaches escaped within the prompt bound and refuses every later action`, () => {
      const { model, prompts, budget } = playPolicy(policy);
      expect(model.state.status).toBe('escaped');
      expect(prompts).toBeLessThanOrEqual(budget);

      const ids = [slotId, ...MANIFEST.finalDoor.slots.map((s) => s.slotId), 'no-such-slot'];
      const after: EventRoomAction[] = [
        { type: 'enterRoom', roomId: MANIFEST.rooms[0]?.roomId ?? '' },
        { type: 'enterFinalDoor' },
        ...ids.flatMap((id): EventRoomAction[] => [
          { type: 'openLock', slotId: id },
          { type: 'useHint', slotId: id },
          { type: 'submitAnswer', slotId: id, submission: { text: 'x' } },
          { type: 'skip', slotId: id },
          { type: 'challenge', slotId: id },
          { type: 'continueEvidence', slotId: id },
        ]),
      ];
      for (const action of after) {
        const next = stepBinding(model, action);
        expect(next.rejection, action.type).not.toBeNull();
        expect(next.state).toBe(model.state);
        expect(next.eventLog).toBe(model.eventLog);
      }
    });
  }
});