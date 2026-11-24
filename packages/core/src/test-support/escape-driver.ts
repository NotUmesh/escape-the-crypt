import { apply } from '../runtime/apply';
import { initial } from '../runtime/initial';
import type { CryptManifest } from '../runtime/manifest-types';
import type { State } from '../runtime/state-types';
import type { Event } from '../types';
import { submissionFor } from './question-answers';
import { SETTINGS } from './run-settings';
import { openTargets, questionFor } from './runtime-model-support';
import type { TerminationPolicy } from './termination-driver';

export interface EscapeResult {
  readonly state: State;
  /** Prompts acted on across rooms and the final door (answer, skip or challenge each count once). */
  readonly prompts: number;
  /** The bound `(totalConcepts x 4) + reservedFinalDoorQuestionCount` for the rooms played. */
  readonly budget: number;
  readonly exhausted: boolean;
  /** Times the run was left and resumed. */
  readonly leaves: number;
  /** True when the crypt was shortened below the manifest's room count. */
  readonly shortened: boolean;
}

function step(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`${event.kind} rejected: ${result.error.kind}`);
  return result.state;
}

function nextRandom(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function chooseEvent(policy: TerminationPolicy, state: State, slotId: string, questionId: string, bits: number): Event {
  const choice = policy === 'seeded random' ? bits % 4 : { 'all wrong': 0, 'all skip': 1, 'all challenge': 2 }[policy];
  if (choice === 1) return { kind: 'Skipped', slotId };
  if (choice === 2) return { kind: 'Challenged', slotId };
  const correct = policy === 'seeded random' && choice === 3;
  return { kind: 'AnswerSubmitted', slotId, submission: submissionFor(questionFor(state.manifest, questionId), correct) };
}

function openDoorTarget(state: State): { slotId: string; questionId: string } | undefined {
  const slot = state.finalDoor.slots.find((s) => s.status === 'open');
  return slot === undefined ? undefined : { slotId: slot.slotId, questionId: slot.currentQuestionId };
}

/**
 * Plays a whole run to the escape under one policy. Rooms are published one at a time, only
 * when the learner is waiting for them. The seed decides whether the crypt is shortened after
 * room 1 and when the run is left and resumed (a left run refuses learner events).
 */
export function playToEscape(manifest: CryptManifest, policy: TerminationPolicy, seed: number): EscapeResult {
  let state = initial(manifest, SETTINGS);
  state = step(state, { kind: 'RunStarted', manifestId: state.manifestId });
  const total = manifest.rooms.length;
  let rng = seed >>> 0;
  const bits = (): number => {
    rng = nextRandom(rng);
    return rng >>> 16;
  };
  const shorten = bits() % 2 === 0 ? 1 + (bits() % total) : total;
  const firstId = manifest.rooms[0]?.roomId ?? '';
  state = step(state, { kind: 'RoomPublished', roomId: firstId });
  state = step(state, { kind: 'CryptFinalised', finalRoomCount: total });
  if (shorten < total) state = step(state, { kind: 'CryptShortened', finalRoomCount: shorten });
  state = step(state, { kind: 'RoomEntered', roomId: firstId });

  const played = manifest.rooms.slice(0, shorten);
  const concepts = played.reduce((n, room) => n + room.lockSlots.length, 0);
  const budget = concepts * 4 + manifest.finalDoor.slots.length;
  let prompts = 0;
  let leaves = 0;

  while (state.status !== 'escaped') {
    const target = state.atFinalDoor ? openDoorTarget(state) : openTargets(state)[0];
    if (target !== undefined) {
      if (prompts >= budget) return { state, prompts, budget, exhausted: true, leaves, shortened: shorten < total };
      if (bits() % 7 === 0) {
        state = step(state, { kind: 'RunLeft' });
        const refused = apply(state, { kind: 'Skipped', slotId: target.slotId });
        if (refused.ok || refused.error.kind !== 'run-left') throw new Error('a left run accepted a learner event');
        state = step(state, { kind: 'RunResumed' });
        leaves += 1;
      }
      state = step(state, chooseEvent(policy, state, target.slotId, target.questionId, bits()));
      prompts += 1;
      continue;
    }
    if (state.atFinalDoor) break; // every door slot closed would already be Escaped
    if (state.finalDoor.available) {
      state = step(state, { kind: 'FinalDoorEntered' });
      continue;
    }
    const index = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
    const next = manifest.rooms[index + 1];
    if (next === undefined || index + 1 >= shorten) break;
    if (state.rooms[index + 1]?.published !== true) state = step(state, { kind: 'RoomPublished', roomId: next.roomId });
    state = step(state, { kind: 'RoomEntered', roomId: next.roomId });
  }
  return { state, prompts, budget, exhausted: state.status !== 'escaped', leaves, shortened: shorten < total };
}
