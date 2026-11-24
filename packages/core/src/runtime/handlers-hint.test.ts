import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import { SETTINGS } from '../test-support/run-settings';
import { apply } from './apply';
import { initial } from './initial';
import type { CryptManifest } from './manifest-types';
import type { LockSlotState, State } from './state-types';
import type { Event } from '../types';

function start(manifest: CryptManifest, hintAllowance = SETTINGS.hintAllowance): State {
  const room = manifest.rooms[0];
  if (!room) throw new Error('fixture');
  let state = initial(manifest, { ...SETTINGS, hintAllowance });
  const events: Event[] = [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: room.roomId },
    { kind: 'RoomEntered', roomId: room.roomId },
  ];
  for (const event of events) {
    const result = apply(state, event);
    if (!result.ok) throw new Error(`setup rejected: ${result.error.kind}`);
    state = result.state;
  }
  return state;
}

const manifest = buildManifest({
  rooms: 1,
  conceptsPerRoom: 2,
  lockTypes: ['seance-board', 'cursed-object'],
  alternates: true,
  hintEffects: true,
});
const room = manifest.rooms[0];
const seanceSpec = room?.lockSlots.find((s) => s.stationType === 'seance-board');
const cursedSpec = room?.lockSlots.find((s) => s.stationType === 'cursed-object');
const maybeAlternate = seanceSpec?.alternateQuestion;
if (!room || !seanceSpec || !cursedSpec || !maybeAlternate) throw new Error('fixture');
const alternate = maybeAlternate;
const slotId = seanceSpec.slotId;
const primary = seanceSpec.primaryQuestion;
const primaryPayload = primary.payload as { optionIds: string[]; keyOptionId: string };
const alternatePayload = alternate.payload as { oddOneOutId: string };

function slotOf(state: State, id: string = slotId): LockSlotState {
  const slot = state.rooms[0]?.lockSlots.find((s) => s.slotId === id);
  if (!slot) throw new Error('slot');
  return slot;
}

function ok(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`rejected: ${result.error.kind}`);
  return result.state;
}

/**
 * Challenge the primary: the real handler replaces the question in place and clears the
 * applied hint (Req 17.1). With `keepStaleHint`, the primary's hint is put back on the slot
 * afterwards, to check that a stale hint is ignored for the Alternate.
 */
function replaceWithAlternate(state: State, keepStaleHint = false): State {
  const stale = slotOf(state).appliedHint;
  const replaced = ok(state, { kind: 'Challenged', slotId });
  if (!keepStaleHint) return replaced;
  const rooms = replaced.rooms.map((r) => ({
    ...r,
    lockSlots: r.lockSlots.map((s) => (s.slotId === slotId ? { ...s, appliedHint: stale } : s)),
  }));
  return { ...replaced, rooms };
}

const hint: Event = { kind: 'HintUsed', slotId };
const answerPrimary: Event = {
  kind: 'AnswerSubmitted',
  slotId,
  submission: { selectedOptionId: primaryPayload.keyOptionId },
};
const answerAlternate: Event = {
  kind: 'AnswerSubmitted',
  slotId,
  submission: { selectedId: alternatePayload.oddOneOutId },
};
const conceptOf = (state: State) => state.concepts.find((c) => c.conceptId === seanceSpec.conceptId);

describe('HintUsed', () => {
  it('spends a hint and records it on the slot with the question shown', () => {
    const before = start(manifest);
    const after = ok(before, hint);
    expect(after.remainingHints).toBe(before.remainingHints - 1);
    expect(slotOf(after).appliedHint).toEqual({
      questionId: primary.questionId,
      effect: primary.hintEffect,
    });
    expect(primary.hintEffect).not.toBeNull();
    expect(after.concepts).toEqual(before.concepts);
    expect(after.candleCount).toBe(before.candleCount);
    expect(after.judgedAnswerCount).toBe(before.judgedAnswerCount);
  });

  it('still consumes a hint when the question has no hint effect', () => {
    const plain = buildManifest({ rooms: 1, conceptsPerRoom: 1, lockTypes: ['rune-cipher'] });
    const slot = plain.rooms[0]?.lockSlots[0];
    if (!slot) throw new Error('fixture');
    const before = start(plain);
    const after = ok(before, { kind: 'HintUsed', slotId: slot.slotId });
    expect(after.remainingHints).toBe(before.remainingHints - 1);
    expect(slotOf(after, slot.slotId).appliedHint).toEqual({
      questionId: slot.primaryQuestion.questionId,
      effect: null,
    });
  });

  it('rejects a second hint on the same question', () => {
    const hinted = ok(start(manifest), hint);
    const result = apply(hinted, hint);
    expect(result).toEqual({ ok: false, error: { kind: 'hint-already-used', slotId } });
  });

  it('rejects a hint when none are left, leaving State unchanged', () => {
    const state = start(manifest, 0);
    const before = JSON.stringify(state);
    const result = apply(state, hint);
    expect(result).toEqual({ ok: false, error: { kind: 'no-hints-left', slotId } });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('never lets the allowance go below zero', () => {
    const one = start(manifest, 1);
    const used = ok(one, hint);
    expect(used.remainingHints).toBe(0);
    const other = apply(used, { kind: 'HintUsed', slotId: cursedSpec.slotId });
    expect(other).toMatchObject({ ok: false, error: { kind: 'no-hints-left' } });
  });

  it('rejects a hint on a settled slot and on an unknown slot', () => {
    const solved = ok(start(manifest), answerPrimary);
    expect(apply(solved, hint)).toMatchObject({
      ok: false,
      error: { kind: 'lock-already-settled' },
    });
    expect(apply(start(manifest), { kind: 'HintUsed', slotId: 'nope' })).toMatchObject({
      ok: false,
      error: { kind: 'unknown-reference' },
    });
  });

  it('does not refund a hint when the question is replaced, and the replacement is unhinted', () => {
    const hinted = ok(start(manifest), hint);
    const replaced = replaceWithAlternate(hinted);
    expect(replaced.remainingHints).toBe(hinted.remainingHints);
    expect(slotOf(replaced).appliedHint).toBeNull();
  });

  it('accepts a hint on the Alternate after the primary was hinted and replaced', () => {
    const replaced = replaceWithAlternate(ok(start(manifest), hint));
    const after = ok(replaced, hint);
    expect(after.remainingHints).toBe(replaced.remainingHints - 1);
    expect(slotOf(after).appliedHint?.questionId).toBe(alternate.questionId);
  });

  it('accepts a hint on the Alternate even if a stale hint for the primary is still stored', () => {
    const replaced = replaceWithAlternate(ok(start(manifest), hint), true);
    const after = ok(replaced, hint);
    expect(slotOf(after).appliedHint?.questionId).toBe(alternate.questionId);
  });
});

describe('hints and assisted answers', () => {
  it('marks a correct answer on a hinted question as assisted', () => {
    const answered = ok(ok(start(manifest), hint), answerPrimary);
    expect(conceptOf(answered)?.hintUsedOnCorrectQuestion).toBe(true);
  });

  it('does not mark a correct answer on an unhinted question as assisted', () => {
    const answered = ok(start(manifest), answerPrimary);
    expect(conceptOf(answered)?.hintUsedOnCorrectQuestion).toBe(false);
  });

  it('does not mark a correct unhinted Alternate after a hinted primary was replaced', () => {
    const replaced = replaceWithAlternate(ok(start(manifest), hint));
    const answered = ok(replaced, answerAlternate);
    expect(slotOf(answered).status).toBe('solved');
    expect(conceptOf(answered)?.hintUsedOnCorrectQuestion).toBe(false);
  });

  it('ignores a stale primary hint when the Alternate is judged', () => {
    const replaced = replaceWithAlternate(ok(start(manifest), hint), true);
    const answered = ok(replaced, answerAlternate);
    expect(conceptOf(answered)?.hintUsedOnCorrectQuestion).toBe(false);
  });

  it('marks a correct hinted Alternate as assisted', () => {
    const replaced = replaceWithAlternate(ok(start(manifest), hint));
    const answered = ok(ok(replaced, hint), answerAlternate);
    expect(conceptOf(answered)?.hintUsedOnCorrectQuestion).toBe(true);
  });
});
