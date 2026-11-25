import { apply } from '@escape-the-crypt/core';
import type { CryptManifest, Event, Outcome_Notice, State, Typed_Rejection } from '@escape-the-crypt/core';
import type { EventRoomAction } from './room-actions';
import { actionToEvent } from './room-event-mapper';

/**
 * The pure model behind `useRoomBinding`. It holds the Event_Log and the State folded from it.
 * Draft_Answer values never appear here; a draft reaches the model only inside a `submitAnswer`.
 */
export interface BindingModel {
  readonly manifest: CryptManifest;
  readonly eventLog: readonly Event[];
  readonly state: State;
  readonly notices: readonly Outcome_Notice[];
  readonly rejection: Typed_Rejection | null;
}

/**
 * One action in, one model out. Accepted: the log grows by one Event, state and notices are
 * replaced (not accumulated), rejection is cleared. Rejected: log and state are unchanged, notices
 * are cleared and `rejection` is set. No rule is decided here; `apply` decides.
 */
export function stepBinding(model: BindingModel, action: EventRoomAction): BindingModel {
  const event = actionToEvent(action);
  const result = apply(model.state, event);
  if (!result.ok) return { ...model, notices: [], rejection: result.error };
  return {
    manifest: model.manifest,
    eventLog: [...model.eventLog, event],
    state: result.state,
    notices: result.notices,
    rejection: null,
  };
}
