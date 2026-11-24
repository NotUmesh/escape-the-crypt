import { describe, expect, it } from 'vitest';
import type { Event } from '../types';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest, QuestionSpec } from './manifest-types';
import type { State } from './state-types';

const RUN_LENGTH = 40;

function fold(start: State, events: readonly Event[]): State {
  let state = start;
  for (const event of events) {
    const r = apply(state, event);
    // A refused event leaves the State unchanged, as a caller replaying the log would see.
    if (r.ok) state = r.state;
  }
  return state;
}

function questionMap(manifest: CryptManifest): Map<string, QuestionSpec> {
  const map = new Map<string, QuestionSpec>();
  for (const spec of manifest.rooms.flatMap((r) => r.lockSlots)) {
    map.set(spec.primaryQuestion.questionId, spec.primaryQuestion);
    if (spec.alternateQuestion) map.set(spec.alternateQuestion.questionId, spec.alternateQuestion);
  }
  return map;
}

/** Builds a fixed, fully accepted run of exactly RUN_LENGTH events by driving the reducer. */
function buildRun(manifest: CryptManifest): readonly Event[] {
  const questions = questionMap(manifest);
  const events: Event[] = [];
  let state = initial(manifest, SETTINGS);
  const push = (event: Event): void => {
    const r = apply(state, event);
    if (!r.ok) throw new Error(`script rejected ${event.kind}: ${r.error.kind}`);
    state = r.state;
    events.push(event);
  };
  const room = () => state.rooms.find((r) => r.roomId === state.currentRoomId) ?? state.rooms[0];
  const shownQuestion = (slotId: string): QuestionSpec => {
    const all = state.rooms.flatMap((r) => [...r.lockSlots, ...r.dueReturnSlots]);
    const id = all.find((s) => s.slotId === slotId)?.currentQuestionId;
    const q = id === undefined ? undefined : questions.get(id);
    if (!q) throw new Error(`no question for ${slotId}`);
    return q;
  };
  const answer = (slotId: string, correct: boolean): void => {
    const isLock = room()?.lockSlots.some((s) => s.slotId === slotId) ?? false;
    if (isLock && state.focusedSlotId !== slotId) push({ kind: 'LockOpened', slotId });
    push({ kind: 'AnswerSubmitted', slotId, submission: submissionFor(shownQuestion(slotId), correct) });
  };
  const openEvidence = (): string | undefined => {
    const all = state.rooms.flatMap((r) => [...r.lockSlots, ...r.dueReturnSlots]);
    return all.find((s) => s.evidencePanelOpen)?.slotId;
  };
  const specs = manifest.rooms[0]?.lockSlots ?? [];
  const ids = specs.map((s) => s.slotId);
  const slot = (i: number): string => ids[i] ?? '';

  const roomId = manifest.rooms[0]?.roomId ?? '';
  push({ kind: 'RunStarted', manifestId: manifest.manifestId });
  push({ kind: 'RoomPublished', roomId });
  push({ kind: 'RoomEntered', roomId });
  push({ kind: 'LockOpened', slotId: slot(0) });
  push({ kind: 'HintUsed', slotId: slot(0) });
  answer(slot(0), true);
  push({ kind: 'EvidenceContinued', slotId: slot(0) });
  answer(slot(1), false);
  push({ kind: 'EvidenceContinued', slotId: slot(1) });
  answer(slot(2), false);
  push({ kind: 'EvidenceContinued', slotId: slot(2) });
  push({ kind: 'Skipped', slotId: slot(3) });
  push({ kind: 'Challenged', slotId: slot(4) });
  answer(slot(4), true);
  push({ kind: 'EvidenceContinued', slotId: slot(4) });
  answer(slot(5), false);

  let returnsAnswered = 0;
  let lockCount = 0;
  while (events.length < RUN_LENGTH) {
    const pending = openEvidence();
    if (pending !== undefined) {
      push({ kind: 'EvidenceContinued', slotId: pending });
      continue;
    }
    const next = room()?.dueReturnSlots.find((s) => s.status === 'open');
    if (!next) {
      const lock = room()?.lockSlots.find((s) => s.status === 'open');
      if (lock) {
        lockCount += 1;
        if (lockCount % 3 === 0) push({ kind: 'Challenged', slotId: lock.slotId });
        else answer(lock.slotId, lockCount % 2 === 0);
        continue;
      }
      break;
    }
    if (returnsAnswered === 0 && state.remainingHints > 0) {
      push({ kind: 'HintUsed', slotId: next.slotId });
      if (events.length >= RUN_LENGTH) break;
    }
    answer(next.slotId, returnsAnswered % 2 === 0);
    returnsAnswered += 1;
  }
  // Tail: events the reducer must refuse. They leave the State unchanged.
  const refused: Event[] = [
    { kind: 'AnswerSubmitted', slotId: slot(0), submission: {} },
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'EvidenceContinued', slotId: slot(0) },
    { kind: 'HintUsed', slotId: slot(0) },
    { kind: 'Skipped', slotId: slot(1) },
  ];
  for (let i = 0; events.length < RUN_LENGTH; i += 1) {
    const event = refused[i % refused.length] as Event;
    if (apply(state, event).ok) throw new Error(`expected refusal of ${event.kind}`);
    events.push(event);
  }
  return events;
}

describe('reload at any point (Req 4.3, 4.4, 4.5)', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true, hintEffects: true });
  const events = buildRun(manifest);
  const start = initial(manifest, SETTINGS);
  const uninterrupted = fold(start, events);

  it('uses a fixed 40-event run that exercises every named event kind', () => {
    expect(events).toHaveLength(RUN_LENGTH);
    const kinds = new Set(events.map((e) => e.kind));
    for (const kind of [
      'RunStarted',
      'RoomPublished',
      'RoomEntered',
      'LockOpened',
      'AnswerSubmitted',
      'HintUsed',
      'Skipped',
      'Challenged',
      'EvidenceContinued',
    ] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(uninterrupted.ghosts.length + uninterrupted.rooms[0]!.dueReturnSlots.length).toBeGreaterThan(0);
  });

  it('serialising the State after any prefix and continuing gives the uninterrupted State', () => {
    for (let n = 1; n <= RUN_LENGTH; n += 1) {
      const mid = fold(start, events.slice(0, n));
      const reloaded = JSON.parse(JSON.stringify(mid)) as State;
      expect(reloaded).toEqual(mid);
      expect(fold(reloaded, events.slice(n))).toEqual(uninterrupted);
    }
  });
});
