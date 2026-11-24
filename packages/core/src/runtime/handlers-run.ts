import type { Event } from '../types';
import { manifestCheck } from './manifest-check';
import { accept, reject } from './result';
import { refreshFinalDoor } from './room-clearing';
import type { ApplyResult } from './result';
import type { State } from './state-types';

type RunStartedEvent = Extract<Event, { kind: 'RunStarted' }>;

type CryptFinalisedEvent = Extract<Event, { kind: 'CryptFinalised' }>;
type CryptShortenedEvent = Extract<Event, { kind: 'CryptShortened' }>;

/** Record the final room count; open the Final_Door if every room up to it is Cleared (Req 7.4, 7.7). */
export function handleCryptFinalised(state: State, event: CryptFinalisedEvent): ApplyResult {
  return accept(refreshFinalDoor({ ...state, finalRoomCount: event.finalRoomCount }));
}

/**
 * Record a shorter final room count. Below the number of published rooms it is refused
 * (Req 7.6); otherwise published rooms stay as they are (Req 7.5, 7.7).
 */
export function handleCryptShortened(state: State, event: CryptShortenedEvent): ApplyResult {
  const published = state.rooms.filter((r) => r.published).length;
  if (event.finalRoomCount < published) return reject('cannot-shorten-published');
  return accept(refreshFinalDoor({ ...state, finalRoomCount: event.finalRoomCount }));
}

/** Leave the run: only the status changes (Req 21.1, 21.2). */
export function handleRunLeft(state: State): ApplyResult {
  if (state.status === 'left') return reject('cannot-leave');
  return accept({ ...state, status: 'left' });
}

/** Resume a left run: only the status changes back (Req 21.3, 21.4). */
export function handleRunResumed(state: State): ApplyResult {
  if (state.status !== 'left') return reject('run-not-left');
  return accept({ ...state, status: 'in progress' });
}

/** Start the run: check the manifest, then set status and the hint allowance. */
export function handleRunStarted(state: State, event: RunStartedEvent): ApplyResult {
  if (event.manifestId !== state.manifestId) return reject('manifest-mismatch');
  if (state.status !== 'not started') return reject('run-already-started');
  const check = manifestCheck(state.manifest);
  if (!check.ok) return { ok: false, error: check.error };
  return accept({
    ...state,
    status: 'in progress',
    remainingHints: state.settings.hintAllowance,
  });
}
