import fc from 'fast-check';
import { expect } from 'vitest';
import type { Event } from '../types';
import { submissionFor } from './question-answers';
import {
  applyChecked,
  checkInvariants,
  closedTargets,
  openTargets,
  questionFor,
  roomTargets,
  viewSlot,
} from './runtime-model-support';
import type { Model, Real, Target } from './runtime-model-support';

export type RuntimeCommand = fc.Command<Model, Real>;

/**
 * Wrap a command with the invariant check. Unless `anyStatus` is set, the command does nothing
 * while the run is left or escaped (those states have their own commands).
 */
export function command(
  name: string,
  check: (m: Readonly<Model>) => boolean,
  run: (m: Model, r: Real) => void,
  anyStatus = false,
): RuntimeCommand {
  return {
    check,
    run: (m, r) => {
      const idle = r.state.status === 'left' || r.state.status === 'escaped';
      if (anyStatus || !idle) run(m, r);
      checkInvariants(m, r);
    },
    toString: () => name,
  };
}

const always = (): boolean => true;
const inPlay = (m: Readonly<Model>): boolean => m.entered;

export function pickOf(list: readonly Target[], pick: number): Target | null {
  return list.length === 0 ? null : (list[pick % list.length] ?? null);
}

/** Expect a rejection of `kind` with State unchanged (applyChecked asserts the no-op). */
export function expectRejected(real: Real, event: Event, kind: string): void {
  const result = applyChecked(real, event);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe(kind);
}

// --- Valid commands, one per event kind handled so far -------------------------------------

export const runStarted = (): RuntimeCommand =>
  command('RunStarted', (m) => !m.started, (m, r) => {
    const result = applyChecked(r, { kind: 'RunStarted', manifestId: r.state.manifestId });
    expect(result.ok).toBe(true);
    m.started = true;
    m.hints = r.state.settings.hintAllowance;
  });

export const roomPublished = (): RuntimeCommand =>
  command('RoomPublished (all rooms)', (m) => m.started && !m.published, (m, r) => {
    for (const room of r.state.manifest.rooms) {
      expect(applyChecked(r, { kind: 'RoomPublished', roomId: room.roomId }).ok).toBe(true);
    }
    m.published = true;
  });

export const roomPublishedAgain = (): RuntimeCommand =>
  command('RoomPublished (duplicate is a no-op)', (m) => m.published, (_m, r) => {
    const roomId = r.state.manifest.rooms[0]?.roomId ?? '';
    const before = r.state;
    expect(applyChecked(r, { kind: 'RoomPublished', roomId }).ok).toBe(true);
    expect(r.state).toEqual(before);
  });

export const roomEntered = (): RuntimeCommand =>
  command('RoomEntered (room 1)', (m) => m.published && !m.entered, (m, r) => {
    const roomId = r.state.manifest.rooms[0]?.roomId ?? '';
    expect(applyChecked(r, { kind: 'RoomEntered', roomId }).ok).toBe(true);
    m.entered = true;
  });

export const lockOpened = (pick: number): RuntimeCommand =>
  command(`LockOpened #${pick}`, inPlay, (_m, r) => {
    const t = pickOf(openTargets(r.state), pick);
    if (t === null) return;
    expect(applyChecked(r, { kind: 'LockOpened', slotId: t.slotId }).ok).toBe(true);
    expect(r.state.focusedSlotId).toBe(t.slotId);
  });

export const hintUsed = (pick: number): RuntimeCommand =>
  command(`HintUsed #${pick}`, inPlay, (m, r) => {
    const t = pickOf(openTargets(r.state), pick);
    if (t === null) return;
    const hadHint = viewSlot(r.state, t.slotId)?.hinted === true;
    const result = applyChecked(r, { kind: 'HintUsed', slotId: t.slotId });
    expect(result.ok).toBe(m.hints > 0 && !hadHint);
    if (result.ok) {
      m.hints -= 1;
      expect(viewSlot(r.state, t.slotId)?.hinted).toBe(true);
    } else {
      expect(result.error.kind).toBe(hadHint ? 'hint-already-used' : 'no-hints-left');
    }
  });

export const answerSubmitted = (pick: number, correct: boolean): RuntimeCommand =>
  command(`AnswerSubmitted #${pick} ${correct ? 'correct' : 'wrong'}`, inPlay, (m, r) => {
    const t = pickOf(openTargets(r.state), pick);
    if (t === null) return;
    const question = questionFor(r.state.manifest, t.questionId);
    const submission = submissionFor(question, correct);
    const result = applyChecked(r, { kind: 'AnswerSubmitted', slotId: t.slotId, submission });
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-submission'); // e.g. a hint removed that option
      return;
    }
    m.judged += 1;
    if (correct) m.candles += 1;
    expect(viewSlot(r.state, t.slotId)?.evidencePanelOpen).toBe(true);
    if (correct) expect(viewSlot(r.state, t.slotId)?.status).toBe('solved');
    else expect(viewSlot(r.state, t.slotId)?.status).not.toBe('solved');
  });

export const evidenceContinued = (pick: number): RuntimeCommand =>
  command(`EvidenceContinued #${pick}`, inPlay, (_m, r) => {
    const t = pickOf(roomTargets(r.state), pick);
    if (t === null) return;
    const open = viewSlot(r.state, t.slotId)?.evidencePanelOpen === true;
    const result = applyChecked(r, { kind: 'EvidenceContinued', slotId: t.slotId });
    expect(result.ok).toBe(open);
    if (!result.ok) expect(result.error.kind).toBe('no-evidence-open');
  });

export const skipped = (pick: number): RuntimeCommand =>
  command(`Skipped #${pick}`, inPlay, (m, r) => {
    const t = pickOf(openTargets(r.state), pick);
    if (t === null) return;
    const result = applyChecked(r, { kind: 'Skipped', slotId: t.slotId });
    expect(result.ok).toBe(true);
    expect(r.state.candleCount).toBe(m.candles); // a skip lights no candle
    expect(r.state.judgedAnswerCount).toBe(m.judged); // and is not a judged answer
  });

export const challenged = (pick: number): RuntimeCommand =>
  command(`Challenged #${pick}`, inPlay, (m, r) => {
    const t = pickOf(openTargets(r.state), pick);
    if (t === null) return;
    const ghosts = r.state.ghosts.length;
    const result = applyChecked(r, { kind: 'Challenged', slotId: t.slotId });
    expect(result.ok).toBe(true);
    expect(r.state.candleCount).toBe(m.candles); // a challenge lights no candle
    expect(r.state.judgedAnswerCount).toBe(m.judged);
    expect(r.state.ghosts.length).toBeLessThanOrEqual(ghosts); // and spawns no ghost
  });

// --- Deliberately invalid variants: expected kind, State unchanged -------------------------

export const answerBeforeStart = (): RuntimeCommand =>
  command('AnswerSubmitted before RunStarted', (m) => !m.started, (_m, r) => {
    expectRejected(r, { kind: 'AnswerSubmitted', slotId: 'any', submission: {} }, 'run-not-started');
  });

export const runStartedAgain = (): RuntimeCommand =>
  command('RunStarted again', (m) => m.started, (_m, r) => {
    const kind = r.state.status === 'escaped' ? 'run-finished' : 'run-already-started';
    expectRejected(r, { kind: 'RunStarted', manifestId: r.state.manifestId }, kind);
  }, true);

export const staleSlot = (): RuntimeCommand =>
  command('stale slot id', inPlay, (_m, r) => {
    for (const kind of ['LockOpened', 'HintUsed', 'Skipped', 'Challenged', 'EvidenceContinued'] as const) {
      expectRejected(r, { kind, slotId: 'slot-from-another-run' }, 'unknown-reference');
    }
  });

export const doubleSubmit = (pick: number): RuntimeCommand =>
  command(`double submit #${pick}`, inPlay, (_m, r) => {
    const t = pickOf(closedTargets(r.state), pick);
    if (t === null) return;
    const question = questionFor(r.state.manifest, t.questionId);
    expectRejected(
      r,
      { kind: 'AnswerSubmitted', slotId: t.slotId, submission: submissionFor(question, true) },
      'lock-already-settled',
    );
    expectRejected(r, { kind: 'HintUsed', slotId: t.slotId }, 'lock-already-settled');
    expectRejected(r, { kind: 'Skipped', slotId: t.slotId }, 'lock-already-settled');
    expectRejected(r, { kind: 'Challenged', slotId: t.slotId }, 'lock-already-settled');
  });

export const hintAtZero = (pick: number): RuntimeCommand =>
  command(`hint at zero #${pick}`, (m) => m.entered && m.hints === 0, (_m, r) => {
    const t = pickOf(openTargets(r.state), pick);
    if (t === null) return;
    const result = applyChecked(r, { kind: 'HintUsed', slotId: t.slotId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['no-hints-left', 'hint-already-used']).toContain(result.error.kind);
  });

export const enterUnknownRoom = (): RuntimeCommand =>
  command('RoomEntered unknown room', always, (_m, r) => {
    const result = applyChecked(r, { kind: 'RoomEntered', roomId: 'no-such-room' });
    expect(result.ok).toBe(false);
  });
