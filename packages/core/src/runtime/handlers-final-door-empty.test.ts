import { describe, expect, it } from 'vitest';
import type { Event } from '../types';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import { manifestCheck } from './manifest-check';
import type { CryptManifest } from './manifest-types';
import type { Outcome_Notice } from './notices';
import type { State } from './state-types';

/** A Final_Door with no reserved questions (Req 20.1, 20.12). */
const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 2, alternates: true, finalDoorQuestions: 0 });
const room = manifest.rooms[0];
const specA = room?.lockSlots[0];
const specB = room?.lockSlots[1];
if (!room || !specA || !specB) throw new Error('fixture');

function run(state: State, ...events: Event[]): { state: State; notices: readonly Outcome_Notice[] } {
  let current = state;
  let notices: readonly Outcome_Notice[] = [];
  for (const event of events) {
    const result = apply(current, event);
    if (!result.ok) throw new Error(`setup rejected ${event.kind}: ${result.error.kind}`);
    current = result.state;
    notices = result.notices;
  }
  return { state: current, notices };
}

const started = (): State =>
  run(
    initial(manifest, SETTINGS),
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: room.roomId },
    { kind: 'CryptFinalised', finalRoomCount: 1 },
    { kind: 'RoomEntered', roomId: room.roomId },
  ).state;

const answerPrimary = (spec: typeof specA, correct: boolean): Event => ({
  kind: 'AnswerSubmitted',
  slotId: spec.slotId,
  submission: submissionFor(spec.primaryQuestion, correct),
});

const escapedCount = (notices: readonly Outcome_Notice[]): number => notices.filter((n) => n.kind === 'escaped').length;

describe('final door with zero reserved questions', () => {
  it('has no reserved slots and passes the manifest check', () => {
    expect(manifest.finalDoor.slots).toHaveLength(0);
    expect(manifestCheck(manifest).ok).toBe(true);
  });

  it('accepts 0 to 4 reserved questions and rejects 5 (Req 20.1)', () => {
    for (const n of [0, 1, 4]) {
      expect(manifestCheck(buildManifest({ finalDoorQuestions: n })).ok).toBe(true);
    }
    const four = buildManifest({ finalDoorQuestions: 4 });
    const extra = four.finalDoor.slots[0];
    if (extra === undefined) throw new Error('fixture');
    const five: CryptManifest = {
      ...four,
      finalDoor: {
        slots: [
          ...four.finalDoor.slots,
          { ...extra, slotId: 'final-door-slot-5', question: { ...extra.question, questionId: 'q-extra' } },
        ],
      },
    };
    expect(manifestCheck(five)).toEqual({
      ok: false,
      error: { kind: 'invalid-manifest', reason: 'too-many-final-door-questions', count: 5 },
    });
  });

  it('escapes on FinalDoorEntered with one escaped notice when every lock was solved', () => {
    const cleared = run(started(), answerPrimary(specA, true), answerPrimary(specB, true)).state;
    expect(cleared.finalDoor.available).toBe(true);
    expect(cleared.status).toBe('in progress');
    const entered = run(cleared, { kind: 'FinalDoorEntered' });
    expect(entered.state.status).toBe('escaped');
    expect(entered.state.finalDoor.slots).toHaveLength(0);
    expect(escapedCount(entered.notices)).toBe(1);
    expect(apply(entered.state, { kind: 'FinalDoorEntered' })).toMatchObject({
      ok: false,
      error: { kind: 'run-finished' },
    });
  });

  it('shows the outstanding return at the door, then escapes once it is settled', () => {
    const cleared = run(started(), answerPrimary(specA, false), answerPrimary(specB, true)).state;
    const entered = run(cleared, { kind: 'FinalDoorEntered' });
    expect(entered.state.status).toBe('in progress');
    expect(escapedCount(entered.notices)).toBe(0);
    const slots = entered.state.finalDoor.slots;
    expect(slots).toHaveLength(1);
    const returnSlot = slots[0];
    if (returnSlot === undefined || specA.alternateQuestion === null) throw new Error('fixture');
    expect(returnSlot).toMatchObject({ origin: 'return', conceptId: specA.conceptId, status: 'open' });

    const done = run(entered.state, {
      kind: 'AnswerSubmitted',
      slotId: returnSlot.slotId,
      submission: submissionFor(specA.alternateQuestion, true),
    });
    expect(done.state.status).toBe('escaped');
    expect(escapedCount(done.notices)).toBe(1);
  });
});
