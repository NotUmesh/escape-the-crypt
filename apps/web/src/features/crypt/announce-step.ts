import type { Outcome_Notice, State } from '@escape-the-crypt/core';
import { announcementsFor } from './announcements';

/** What the announcer has already spoken for. Held in a ref by `CryptFlow`; holds no game state. */
export interface AnnounceTracker {
  readonly state: State | null;
  readonly notices: readonly Outcome_Notice[];
}
export const EMPTY_TRACKER: AnnounceTracker = { state: null, notices: [] };

/**
 * The live-region messages for one render. A new State announces its evidence, status and any
 * notices it came with. Notices can arrive one render later for the same State (the saved-run flow
 * holds them until the Event is written); those are announced then, once. A first State (a start
 * or a restore) announces nothing.
 */
export function announceStep(
  tracker: AnnounceTracker,
  state: State | null,
  notices: readonly Outcome_Notice[],
): { readonly tracker: AnnounceTracker; readonly messages: readonly string[] } {
  if (state === null) return { tracker: EMPTY_TRACKER, messages: [] };
  if (tracker.state !== state) {
    const messages = tracker.state === null ? [] : announcementsFor(tracker.state, state, notices);
    return { tracker: { state, notices }, messages };
  }
  if (notices === tracker.notices || notices.length === 0) return { tracker: { state, notices }, messages: [] };
  // Same State, late notices: the evidence and status lines were already spoken.
  return { tracker: { state, notices }, messages: announcementsFor(state, state, notices) };
}
