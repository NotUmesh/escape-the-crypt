import { expect } from 'vitest';
import { apply } from '../runtime/apply';
import type { CryptManifest, QuestionSpec } from '../runtime/manifest-types';
import type { Outcome_Notice } from '../runtime/notices';
import type { State } from '../runtime/state-types';
import type { Event } from '../types';

/** What the harness expects, counted independently of the reducer. */
export interface Model {
  started: boolean;
  published: boolean;
  entered: boolean;
  /** Accepted correct answers (lock and return slots). */
  candles: number;
  /** Judged answers (correct or wrong) the harness has seen accepted. */
  judged: number;
  /** Allowance minus accepted hints. */
  hints: number;
}

/** The real system under test: the latest State. */
export interface Real {
  state: State;
  /** When present, every accepted event is appended with the notices it emitted. */
  trace?: TraceEntry[];
}

export interface TraceEntry {
  readonly event: Event;
  readonly notices: readonly Outcome_Notice[];
}

export interface Target {
  readonly slotId: string;
  readonly questionId: string;
  readonly kind: 'lock' | 'return' | 'door';
}

/** Apply one event. A rejection must leave State untouched (Property 5); returns the result. */
export function applyChecked(real: Real, event: Event): ReturnType<typeof apply> {
  const before = JSON.parse(JSON.stringify(real.state)) as State;
  const result = apply(real.state, event);
  if (result.ok) {
    expect(real.state).toEqual(before); // the input is never mutated
    real.state = result.state;
    real.trace?.push({ event, notices: result.notices });
  } else {
    expect(real.state).toEqual(before); // invalid events are no-ops
    expect(result.error.kind).toBeTypeOf('string');
  }
  return result;
}

interface PlayableSlot {
  readonly slotId: string;
  readonly currentQuestionId: string;
  readonly status: string;
  readonly evidencePanelOpen: boolean;
  readonly appliedHint: { readonly questionId: string } | null;
}

/** Slots in play: the Final_Door's once it is entered, otherwise the current room's. */
function playable(state: State): { slot: PlayableSlot; kind: Target['kind'] }[] {
  if (state.atFinalDoor) return state.finalDoor.slots.map((slot) => ({ slot, kind: 'door' as const }));
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  if (room === undefined) return [];
  return [
    ...room.lockSlots.map((slot) => ({ slot, kind: 'lock' as const })),
    ...room.dueReturnSlots.map((slot) => ({ slot, kind: 'return' as const })),
  ];
}

/** Slots in play, open or not. */
export function roomTargets(state: State): Target[] {
  return playable(state).map(({ slot, kind }) => ({ slotId: slot.slotId, questionId: slot.currentQuestionId, kind }));
}

export function statusOf(state: State, slotId: string): string | null {
  return playable(state).find((p) => p.slot.slotId === slotId)?.slot.status ?? null;
}

export interface SlotView {
  readonly status: string;
  readonly evidencePanelOpen: boolean;
  readonly hinted: boolean;
}

/** The slot in play with this ID, as the few fields the commands read. */
export function viewSlot(state: State, slotId: string): SlotView | null {
  const slot = playable(state).find((p) => p.slot.slotId === slotId)?.slot;
  if (slot === undefined) return null;
  return {
    status: slot.status,
    evidencePanelOpen: slot.evidencePanelOpen,
    hinted: slot.appliedHint !== null && slot.appliedHint.questionId === slot.currentQuestionId,
  };
}
/** Open slots of the current room. */
export function openTargets(state: State): Target[] {
  return roomTargets(state).filter((t) => statusOf(state, t.slotId) === 'open');
}

/** Slots of the current room that are already solved, settled or challenged. */
export function closedTargets(state: State): Target[] {
  return roomTargets(state).filter((t) => statusOf(state, t.slotId) !== 'open');
}

export function questionFor(manifest: CryptManifest, questionId: string): QuestionSpec {
  for (const room of manifest.rooms) {
    for (const spec of room.lockSlots) {
      if (spec.primaryQuestion.questionId === questionId) return spec.primaryQuestion;
      if (spec.alternateQuestion?.questionId === questionId) return spec.alternateQuestion;
    }
  }
  for (const slot of manifest.finalDoor.slots) {
    if (slot.question.questionId === questionId) return slot.question;
  }
  throw new Error(`unknown question ${questionId}`);
}

/** Model-level invariants of Properties 2, 3, 8 and 14, checked after every command. */
export function checkInvariants(model: Model, real: Real): void {
  const s = real.state;
  // Property 2: candles follow accepted correct answers only.
  expect(s.candleCount).toBe(model.candles);
  expect(s.judgedAnswerCount).toBe(model.judged);
  const lockSlots = s.rooms.flatMap((r) => r.lockSlots);
  const returnSlots = s.rooms.flatMap((r) => r.dueReturnSlots);
  const spirit = s.rooms.reduce((n, r) => n + r.spiritCandles.length, 0);
  const door = s.finalDoor.slots;
  const doorLit = door.filter((x) => x.origin === 'reserved' && x.candleLit).length + s.finalDoor.spiritCandles.length;
  expect(lockSlots.filter((x) => x.candleLit).length + spirit + doorLit).toBe(s.candleCount);
  // Property 14: the candle flag is true iff the slot is solved.
  for (const slot of [...lockSlots, ...returnSlots, ...door]) expect(slot.candleLit).toBe(slot.status === 'solved');
  // Property 3: one pending ghost per concept, return number at most 2.
  const concepts = s.ghosts.map((g) => g.conceptId);
  expect(new Set(concepts).size).toBe(concepts.length);
  for (const ghost of s.ghosts) expect(ghost.returnNumber).toBeLessThanOrEqual(2);
  // Property 8: hints stay within the allowance.
  expect(s.remainingHints).toBeGreaterThanOrEqual(0);
  if (model.started) expect(s.remainingHints).toBe(model.hints);
}
