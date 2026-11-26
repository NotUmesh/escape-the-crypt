import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, ROOM_START_ERROR_COPY, SAMPLE_CRYPT_LINE } from '@escape-the-crypt/core';
import type { RoomStartErrorKind, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding, StartError } from '../../state/room-binding';
import { announcementsFor } from './announcements';
import { CryptErrorBoundary } from './crypt-error-boundary';
import { AutopsyView, FinalDoor } from './crypt-stand-ins';
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
  const [messages, setMessages] = useState<readonly string[]>(NO_MESSAGES);
  const previous = useRef<State | null>(null);

  const bindingDispatch = binding.dispatch;
  const dispatch = useCallback(
    (action: RoomAction): void => {
      if (action.type === 'playAgain') {
        setAutopsyRequested(false);
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
    view = autopsyRequested ? (
      <AutopsyView state={state} dispatch={dispatch} />
    ) : (
      <FinalDoor state={state} dispatch={dispatch} escaped onOpenAutopsy={() => setAutopsyRequested(true)} />
    );
  } else if (state.status === 'in progress') {
    view = state.atFinalDoor ? (
      <FinalDoor state={state} dispatch={dispatch} />
    ) : (
      <RoomScreen
        state={state}
        dispatch={dispatch}
        renderPanel={(slot, controls) =>
          binding.assets === null ? null : (
            <RoomPanel
              slot={slot}
              state={state}
              assets={binding.assets}
              rejection={binding.rejection}
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

  return (
    <>
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
