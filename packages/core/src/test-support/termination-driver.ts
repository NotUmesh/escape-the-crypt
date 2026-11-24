import { apply } from '../runtime/apply';
import { initial } from '../runtime/initial';
import type { CryptManifest } from '../runtime/manifest-types';
import type { State } from '../runtime/state-types';
import type { Event } from '../types';
import { submissionFor } from './question-answers';
import { SETTINGS } from './run-settings';
import { openTargets, questionFor } from './runtime-model-support';

export type TerminationPolicy = 'all wrong' | 'all skip' | 'all challenge' | 'seeded random';

export interface TerminationResult {
  readonly state: State;
  /** Prompts acted on in the entered room (answer, skip or challenge each count once). */
  readonly prompts: number;
  /** True when the loop stopped because it ran out of its step budget. */
  readonly exhausted: boolean;
}

function step(state: State, event: Event): State {
  const result = apply(state, event);
  if (!result.ok) throw new Error(`${event.kind} rejected: ${result.error.kind}`);
  return result.state;
}

/** Small deterministic generator so the random policy is reproducible from a seed. */
function nextRandom(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function chooseEvent(policy: TerminationPolicy, slotId: string, state: State, questionId: string, seed: number): Event {
  const choice = policy === 'seeded random' ? seed % 4 : { 'all wrong': 0, 'all skip': 1, 'all challenge': 2 }[policy];
  const question = questionFor(state.manifest, questionId);
  if (choice === 1) return { kind: 'Skipped', slotId };
  if (choice === 2) return { kind: 'Challenged', slotId };
  const correct = policy === 'seeded random' && choice === 3;
  return { kind: 'AnswerSubmitted', slotId, submission: submissionFor(question, correct) };
}

/**
 * Plays the entered room (room 1) under one policy until it is Cleared or `budget`
 * prompts are spent. Later rooms are not entered (room progression arrives in task 6.1).
 */
export function playEnteredRoom(
  manifest: CryptManifest,
  policy: TerminationPolicy,
  seed: number,
  budget: number,
): TerminationResult {
  let state = initial(manifest, SETTINGS);
  state = step(state, { kind: 'RunStarted', manifestId: state.manifestId });
  for (const room of manifest.rooms) state = step(state, { kind: 'RoomPublished', roomId: room.roomId });
  const first = manifest.rooms[0];
  if (first === undefined) throw new Error('manifest has no rooms');
  state = step(state, { kind: 'RoomEntered', roomId: first.roomId });

  let prompts = 0;
  let rng = seed >>> 0;
  while (!(state.rooms.find((r) => r.roomId === first.roomId)?.cleared ?? false)) {
    const target = openTargets(state)[0];
    if (target === undefined || prompts >= budget) return { state, prompts, exhausted: true };
    rng = nextRandom(rng);
    state = step(state, chooseEvent(policy, target.slotId, state, target.questionId, rng >>> 16));
    prompts += 1;
  }
  return { state, prompts, exhausted: false };
}
