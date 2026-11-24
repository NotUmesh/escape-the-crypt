import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { submissionFor } from '../test-support/question-answers';
import {
  passDoor,
  questionMap,
  shownQuestionId,
  startRun as start,
  step,
} from '../test-support/sequence-support';
import type { CryptManifest } from './manifest-types';
import { deriveAllOutcomes } from './outcomes';
import { selectAutopsy } from './autopsy-selector';
import type { State } from './state-types';

function answerWrong(manifest: CryptManifest, state: State, slotId: string): State {
  const q = questionMap(manifest).get(shownQuestionId(state, slotId));
  if (!q) throw new Error('question');
  return step(state, { kind: 'AnswerSubmitted', slotId, submission: submissionFor(q, false) }).state;
}

/** Answer every primary slot wrong (or skip those listed), then every Return_Slot wrong. */
function playAllWrong(manifest: CryptManifest, skipFirst = 0): State {
  let state = start(manifest);
  const specs = manifest.rooms[0]?.lockSlots ?? [];
  specs.forEach((spec, i) => {
    state =
      i < skipFirst
        ? step(state, { kind: 'Skipped', slotId: spec.slotId }).state
        : answerWrong(manifest, state, spec.slotId);
  });
  for (let guard = 0; guard < 50; guard += 1) {
    const open = state.rooms[0]?.dueReturnSlots.find((s) => s.status === 'open');
    if (!open) return state;
    state = answerWrong(manifest, state, open.slotId);
  }
  throw new Error('returns did not end');
}

function escape(manifest: CryptManifest, state: State, mode: 'wrong' | 'challenge'): State {
  const finalised = step(state, { kind: 'CryptFinalised', finalRoomCount: 1 }).state;
  const door = passDoor(manifest, finalised, mode);
  expect(door.state.status).toBe('escaped');
  return door.state;
}

function expectCountsSum(state: State): void {
  const view = selectAutopsy(state);
  if (!view.available) throw new Error('autopsy unavailable');
  const total = Object.values(view.counts).reduce((a, b) => a + b, 0);
  expect(total).toBe(state.concepts.length);
  expect(view.entries).toHaveLength(state.concepts.length);
}

describe('named sequence outcomes: all wrong', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true });

  it('escapes with every concept Review due and zero candles', () => {
    const state = escape(manifest, playAllWrong(manifest), 'wrong');
    expect(state.candleCount).toBe(0);
    const outcomes = deriveAllOutcomes(state);
    expect(Object.keys(outcomes)).toHaveLength(6);
    expect(Object.values(outcomes).every((o) => o === 'review-due')).toBe(true);
    const view = selectAutopsy(state);
    expect(view.available && view.counts).toMatchObject({
      'review-due': 6,
      'first-try-correct': 0,
      assisted: 0,
      retried: 0,
      challenged: 0,
    });
    expectCountsSum(state);
  });
});

describe('named sequence outcomes: all challenged', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: true });

  it('escapes with every concept Challenged, zero candles and zero wrong answers', () => {
    let state = start(manifest);
    for (const spec of manifest.rooms[0]?.lockSlots ?? []) {
      state = step(state, { kind: 'Challenged', slotId: spec.slotId }).state;
      state = step(state, { kind: 'Challenged', slotId: spec.slotId }).state;
    }
    state = escape(manifest, state, 'challenge');
    expect(state.candleCount).toBe(0);
    expect(state.judgedAnswerCount).toBe(0);
    expect(state.ghosts).toEqual([]);
    const outcomes = deriveAllOutcomes(state);
    expect(Object.values(outcomes).every((o) => o === 'challenged')).toBe(true);
    const view = selectAutopsy(state);
    expect(view.available && view.counts.challenged).toBe(6);
    expectCountsSum(state);
  });
});

describe('named sequence outcomes: no alternates', () => {
  const manifest = buildManifest({ rooms: 1, conceptsPerRoom: 6, alternates: false });

  it('ends with Review due flags on every concept, including a skipped one', () => {
    const state = escape(manifest, playAllWrong(manifest, 1), 'wrong');
    expect(state.concepts.every((c) => c.reviewDueFlag)).toBe(true);
    expect(Object.values(deriveAllOutcomes(state)).every((o) => o === 'review-due')).toBe(true);
    expectCountsSum(state);
  });
});
