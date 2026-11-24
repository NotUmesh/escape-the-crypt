import { describe, expect, it } from 'vitest';
import type { Event } from '../types';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import { SETTINGS } from '../test-support/run-settings';
import { questionMap, shownQuestionId, step } from '../test-support/sequence-support';
import type { Outcome_Notice } from './notices';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import type { State } from './state-types';

/** Folds a log; every event must be accepted. */
function fold(start: State, events: readonly Event[]): State {
  let state = start;
  for (const event of events) {
    const r = apply(state, event);
    if (!r.ok) throw new Error(`rejected ${event.kind}: ${r.error.kind}`);
    state = r.state;
  }
  return state;
}

interface Run {
  readonly events: readonly Event[];
  readonly notices: readonly Outcome_Notice[];
}

/**
 * Builds the fixed 2-room run by driving the reducer, recording each accepted event.
 * Room 1: a hint, a skip, a challenge and a wrong answer (its ghost is not yet due).
 * Room 2: the ghost comes due and is answered as a Return. Then the final door and escape.
 */
function buildRun(manifest: CryptManifest): Run {
  const questions = questionMap(manifest);
  const events: Event[] = [];
  const notices: Outcome_Notice[] = [];
  let state = initial(manifest, SETTINGS);
  const play = (event: Event): void => {
    const r = step(state, event);
    state = r.state;
    events.push(event);
    notices.push(...r.notices);
  };
  const answer = (slotId: string, correct: boolean): void => {
    const q = questions.get(shownQuestionId(state, slotId));
    if (!q) throw new Error(`no question for ${slotId}`);
    play({ kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, correct) });
  };
  const [room1, room2] = manifest.rooms;
  if (!room1 || !room2) throw new Error('fixture needs 2 rooms');
  const s1 = room1.lockSlots.map((s) => s.slotId);
  const s2 = room2.lockSlots.map((s) => s.slotId);
  const at = (ids: readonly string[], i: number): string => ids[i] ?? '';

  play({ kind: 'RunStarted', manifestId: manifest.manifestId });
  play({ kind: 'RoomPublished', roomId: room1.roomId });
  play({ kind: 'CryptFinalised', finalRoomCount: manifest.rooms.length });
  play({ kind: 'RoomEntered', roomId: room1.roomId });
  play({ kind: 'LockOpened', slotId: at(s1, 0) });
  play({ kind: 'HintUsed', slotId: at(s1, 0) });
  answer(at(s1, 0), true);
  play({ kind: 'Challenged', slotId: at(s1, 1) });
  answer(at(s1, 1), true); // the Alternate that replaced the challenged question
  answer(at(s1, 2), true);
  answer(at(s1, 3), true);
  play({ kind: 'Skipped', slotId: at(s1, 4) }); // queues a return for the skipped concept
  answer(at(s1, 5), false); // ghost spawns; neither return is due until later judged answers

  play({ kind: 'RoomPublished', roomId: room2.roomId });
  play({ kind: 'RoomEntered', roomId: room2.roomId });
  for (const slotId of s2) answer(slotId, true);
  const returns = state.rooms.find((r) => r.roomId === room2.roomId)?.dueReturnSlots ?? [];
  const open = returns.filter((s) => s.status === 'open');
  if (open.length === 0) throw new Error('expected a due Return in room 2');
  for (const ret of open) answer(ret.slotId, true);

  play({ kind: 'FinalDoorEntered' });
  for (const slot of manifest.finalDoor.slots) answer(slot.slotId, true);
  return { events, notices };
}

describe('reload at any point (Req 4.3, 4.4, 4.5)', () => {
  const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 6, alternates: true, hintEffects: true });
  const { events, notices } = buildRun(manifest);
  const start = initial(manifest, SETTINGS);
  const uninterrupted = fold(start, events);

  it('uses a fixed 2-room run that reaches the escape', () => {
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
      'FinalDoorEntered',
    ] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(uninterrupted.status).toBe('escaped');
    expect(notices.filter((n) => n.kind === 'escaped')).toHaveLength(1);
  });

  it('serialising the State after any prefix and continuing gives the uninterrupted State', () => {
    for (let n = 1; n <= events.length; n += 1) {
      const mid = fold(start, events.slice(0, n));
      const reloaded = JSON.parse(JSON.stringify(mid)) as State;
      expect(reloaded).toEqual(mid);
      expect(fold(reloaded, events.slice(n))).toEqual(uninterrupted);
    }
  });
});
