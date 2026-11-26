import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, ROOM_START_ERROR_COPY, SAMPLE_CRYPT_LABEL, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import type { RoomStartErrorKind, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding, StartError } from '../../state/room-binding';
import { announcementsFor } from './announcements';
import { CryptErrorBoundary } from './crypt-error-boundary';
import { AutopsyView } from './autopsy-view';
import { FinalDoor } from './final-door';
import { LiveRegion } from './live-region';
import { RoomPanel } from './room-panel';
import { RoomScreen } from './room-screen';

export interface CryptFlowProps {
  /** Supplies the binding. Defaults to the real one; tests pass a wrapper around it. */
  readonly useBinding?: () => RoomBinding;
}

const NO_MESSAGES: readonly string[] = [];

function startErrorKind(error: StartError | null): RoomStartErrorKind {
  if (error !== null && error.kind in ROOM_START_ERROR_COPY) return error.kind as RoomStartErrorKind;
  return 'start-rejected';
}

function StartView({ dispatch }: { readonly dispatch: (action: RoomAction) => void }): ReactNode {
  return (
    <section className="crypt-start" aria-labelledby="crypt-start-title">
      <h2 id="crypt-start-title">Escape the Crypt</h2>
      <p>{SAMPLE_CRYPT_LINE}</p>
      <button type="button" onClick={() => dispatch({ type: 'startRun' })}>
        {ENTER_CRYPT_LABEL}
      </button>
    </section>
  );
}

function StartFailed({
  error,
  dispatch,
}: {
  readonly error: StartError | null;
  readonly dispatch: (action: RoomAction) => void;
}): ReactNode {
  const copy = ROOM_START_ERROR_COPY[startErrorKind(error)];
  return (
    <section className="crypt-start crypt-start--failed" role="alert" data-testid="start-failed">
      <p>{copy.what}</p>
      <p>{copy.next}</p>
      <button type="button" onClick={() => dispatch({ type: 'startRun' })}>
        {ENTER_CRYPT_LABEL}
      </button>
    </section>
  );
}

function CryptFlowInner({ useBinding = useRoomBinding }: CryptFlowProps): ReactNode {
  const binding = useBinding();
  const { state, notices, phase, startError } = binding;
  const [autopsyRequested, setAutopsyRequested] = useState(false);
  // View-only flag: true once the learner closed the Evidence_Panel of the escaping answer. Holds no game state.
  const [escapeEvidenceDismissed, setEscapeEvidenceDismissed] = useState(false);
  const [messages, setMessages] = useState<readonly string[]>(NO_MESSAGES);
  const previous = useRef<State | null>(null);

  const bindingDispatch = binding.dispatch;
  const dispatch = useCallback(
    (action: RoomAction): void => {
      if (action.type === 'playAgain') {
        setAutopsyRequested(false);
        setEscapeEvidenceDismissed(false);
        // A new run is not a step from the old State, so nothing is announced for it.
        previous.current = null;
      }
      bindingDispatch(action);
    },
    [bindingDispatch],
  );

  // Runs once per State object: an accepted dispatch gives a new State, a rejected one keeps it.
  useEffect(() => {
    if (state === null) {
      previous.current = null;
      return;
    }
    const before = previous.current;
    if (before === state) return;
    previous.current = state;
    if (before === null) return;
    const next = announcementsFor(before, state, notices);
    if (next.length > 0) setMessages(next);
  }, [state, notices]);

  let view: ReactNode;
  if (phase === 'start-failed') {
    view = <StartFailed error={startError} dispatch={dispatch} />;
  } else if (phase !== 'running' || state === null) {
    view = <StartView dispatch={dispatch} />;
  } else if (state.status === 'escaped') {
    // The answer that escaped the run still shows its Evidence_Panel. Its Continue is local (no Event),
    // because the runtime rejects every Event after the escape. Only then does the escape view appear.
    const evidenceStillOpen =
      !escapeEvidenceDismissed &&
      binding.assets !== null &&
      state.finalDoor.slots.some((s) => s.evidencePanelOpen);
    if (autopsyRequested) {
      view = <AutopsyView state={state} assets={binding.assets} dispatch={dispatch} />;
    } else if (evidenceStillOpen) {
      view = (
        <FinalDoor
          state={state}
          dispatch={dispatch}
          assets={binding.assets}
          rejection={binding.rejection}
          eventLog={binding.eventLog}
          onEscapeEvidenceDismissed={() => setEscapeEvidenceDismissed(true)}
        />
      );
    } else {
      view = <FinalDoor escaped onOpenAutopsy={() => setAutopsyRequested(true)} />;
    }
  } else if (state.status === 'in progress') {
    view = state.atFinalDoor ? (
      <FinalDoor
        state={state}
        dispatch={dispatch}
        assets={binding.assets}
        rejection={binding.rejection}
        eventLog={binding.eventLog}
      />
    ) : (
      <RoomScreen
        state={state}
        dispatch={dispatch}
        notices={notices}
        renderPanel={(slot, controls) =>
          binding.assets === null ? null : (
            <RoomPanel
              slot={slot}
              state={state}
              assets={binding.assets}
              rejection={binding.rejection}
              eventLog={binding.eventLog}
              dispatch={dispatch}
              openerRef={controls.openerRef}
              onClose={controls.onClose}
            />
          )
        }
      />
    );
  } else {
    view = <StartView dispatch={dispatch} />;
  }

  // The room screen draws its own label; every other screen of a run gets it here (Requirement 1.6).
  const showLabel = phase === 'running' && state !== null && (state.status === 'escaped' || state.atFinalDoor);

  return (
    <>
      {showLabel ? <p className="room-screen__sample-label">{SAMPLE_CRYPT_LABEL}</p> : null}
      {view}
      <LiveRegion messages={messages} />
    </>
  );
}

/** Owns the room binding and routes between the start view, the room, the final door, the escape view and the Autopsy. */
export function CryptFlow(props: CryptFlowProps): ReactNode {
  return (
    <CryptErrorBoundary>
      <CryptFlowInner {...props} />
    </CryptErrorBoundary>
  );
}
