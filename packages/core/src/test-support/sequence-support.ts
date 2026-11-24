import { apply } from '../runtime/apply';
import { initial } from '../runtime/initial';
import type { CryptManifest, QuestionSpec } from '../runtime/manifest-types';
import type { Outcome_Notice } from '../runtime/notices';
import type { State } from '../runtime/state-types';
import type { Event } from '../types';
import { submissionFor } from './question-answers';
import { SETTINGS } from './run-settings';

export interface Step {
  readonly state: State;
  readonly notices: readonly Outcome_Notice[];
}

/** Apply one event; a rejection fails the test that called it. */
export function step(state: State, event: Event): Step {
  const r = apply(state, event);
  if (!r.ok) throw new Error(`rejected ${event.kind}: ${r.error.kind}`);
  return { state: r.state, notices: r.notices };
}

/** Start the run, publish room 1 and enter it. */
export function startRun(manifest: CryptManifest): State {
  const room = manifest.rooms[0];
  if (!room) throw new Error('fixture');
  let state = initial(manifest, SETTINGS);
  const events: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: room.roomId },
    { kind: 'RoomEntered', roomId: room.roomId },
  ];
  for (const event of events) state = step(state, event).state;
  return state;
}

export function questionMap(manifest: CryptManifest): Map<string, QuestionSpec> {
  const map = new Map<string, QuestionSpec>();
  for (const spec of manifest.rooms.flatMap((r) => r.lockSlots)) {
    map.set(spec.primaryQuestion.questionId, spec.primaryQuestion);
    if (spec.alternateQuestion) map.set(spec.alternateQuestion.questionId, spec.alternateQuestion);
  }
  for (const slot of manifest.finalDoor.slots) map.set(slot.question.questionId, slot.question);
  return map;
}

/** The question a slot currently shows, searched across rooms, Return_Slots and the Final_Door. */
export function shownQuestionId(state: State, slotId: string): string {
  const all = [...state.rooms.flatMap((r) => [...r.lockSlots, ...r.dueReturnSlots]), ...state.finalDoor.slots];
  const id = all.find((s) => s.slotId === slotId)?.currentQuestionId;
  if (id === undefined) throw new Error(`no slot ${slotId}`);
  return id;
}

export function answerAny(manifest: CryptManifest, state: State, slotId: string, correct: boolean): Step {
  const q = questionMap(manifest).get(shownQuestionId(state, slotId));
  if (!q) throw new Error('question');
  return step(state, { kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, correct) });
}

/** Answer every Lock_Slot of one room correctly. */
export function clearRoomCorrectly(manifest: CryptManifest, from: State, roomIndex: number): State {
  let state = from;
  for (const spec of manifest.rooms[roomIndex]?.lockSlots ?? []) {
    state = answerAny(manifest, state, spec.slotId, true).state;
  }
  return state;
}

export type DoorMode = 'correct' | 'wrong' | 'challenge';

/** Enter the Final_Door and settle every open slot (Returns spawned there included) until escape. */
export function passDoor(manifest: CryptManifest, from: State, mode: DoorMode): Step {
  let last = step(from, { kind: 'FinalDoorEntered' });
  for (let guard = 0; guard < 50; guard += 1) {
    const open = last.state.finalDoor.slots.find((s) => s.status === 'open');
    if (!open) return last;
    last =
      mode === 'challenge'
        ? step(last.state, { kind: 'Challenged', slotId: open.slotId })
        : answerAny(manifest, last.state, open.slotId, mode === 'correct');
  }
  throw new Error('door did not end');
}
