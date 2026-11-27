import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ENTER_CRYPT_LABEL, GENERATION_COPY, ROOM_START_ERROR_COPY, SAMPLE_CRYPT_LABEL } from '@escape-the-crypt/core';
import type { RoomStartErrorKind, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { usePersistedRoomBinding } from '../../state/persisted-room';
import type { BuildCrypt, BuiltCrypt, RoomBinding, StartError } from '../../state/room-binding';
import { buildSampleCrypt } from '../../state/sample-crypt-source';
import { isGenerating } from '../generate/generation-flow';
import { resolveClient, resolveOrigin } from '../generate/generate-seams';
import type { GenerateSeams } from '../generate/generate-seams';
import { useGeneration } from '../generate/use-generation';
import { announcementsFor } from './announcements';
import { CryptErrorBoundary } from './crypt-error-boundary';
import { AutopsyView } from './autopsy-view';
import { FinalDoor } from './final-door';
import { LanternProvider } from './lantern-context';
import { LiveRegion } from './live-region';
import { RoomPanel } from './room-panel';
import { RoomScreen } from './room-screen';
import { SaveBanner } from '../start/save-banner';
import { StartView } from './start-view';
import type { SceneLoader } from './use-scene';

export interface CryptFlowProps {
  /** Loads each room's Scene_File. Tests inject one. */
  readonly loadSceneImpl?: SceneLoader;
  /** Supplies the binding. Defaults to the real one; tests pass a wrapper around it. */
  readonly useBinding?: (buildCrypt: BuildCrypt) => RoomBinding;
  /** The confirmed notes text for Generate from my notes. Without it the button is hidden. */
  readonly notesText?: string;
  /** Digest of the confirmed notes record, saved with the generated crypt so a restore can find the notes. */
  readonly notesDigest?: string;
  readonly generate?: GenerateSeams;
  /** Reads a message through the host's polite live region. Called with '' to clear it. */
  readonly onAnnounce?: (message: string) => void;
}

const NO_MESSAGES: readonly string[] = [];

function startErrorKind(error: StartError | null): RoomStartErrorKind {
  if (error !== null && error.kind in ROOM_START_ERROR_COPY) return error.kind as RoomStartErrorKind;
  return 'start-rejected';
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

function CryptFlowInner({ useBinding = usePersistedRoomBinding, loadSceneImpl, notesText, notesDigest, generate, onAnnounce }: CryptFlowProps): ReactNode {
  // Which crypt startRun builds: the generated one once it is ready, else the sample.
  const playRef = useRef<BuiltCrypt | null>(null);
  const buildCrypt = useCallback<BuildCrypt>(
    () => (playRef.current === null ? buildSampleCrypt() : { ok: true, value: playRef.current }),
    [],
  );
  const binding = useBinding(buildCrypt);
  const origin = resolveOrigin(generate);
  const client = useMemo(() => resolveClient(generate, origin), [generate, origin]);
  const generation = useGeneration({
    client,
    intervalMs: generate?.intervalMs,
    maxPolls: generate?.maxPolls,
    newKey: generate?.newKey,
  });
  const canGenerate = origin !== null && notesText !== undefined;
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

  const startSample = useCallback((): void => {
    playRef.current = null;
    dispatch({ type: 'startRun' });
  }, [dispatch]);
  const generationState = generation.state;
  const readyCrypt = generation.crypt;
  // A finished job starts room 1 of the generated crypt through the same binding as the sample.
  useEffect(() => {
    if (generationState.status !== 'ready') return;
    const crypt = readyCrypt();
    if (crypt === null) return;
    playRef.current = crypt;
    bindingDispatch({ type: 'startRun' });
  }, [generationState, readyCrypt, bindingDispatch]);
  // The progress line and the stopped message are read through the host's announcer, not a region here.
  const generationStatus = generationState.status;
  useEffect(() => {
    if (onAnnounce === undefined) return;
    if (generationStatus === 'starting' || generationStatus === 'polling') onAnnounce(GENERATION_COPY.progress);
    else if (generationStatus === 'cancelled') onAnnounce(GENERATION_COPY.cancelled);
    else onAnnounce('');
  }, [generationStatus, onAnnounce]);
  const startView = (
    <StartView
      onEnter={startSample}
      generation={
        canGenerate
          ? {
              state: generationState,
              onGenerate: () => generation.start(notesText, notesDigest),
              onCancel: generation.cancel,
              onPlaySample: startSample,
            }
          : undefined
      }
    />
  );
  let view: ReactNode;
  if (phase === 'start-failed') {
    view = <StartFailed error={startError} dispatch={dispatch} />;
  } else if (phase !== 'running' || state === null) {
    view = startView;
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
          loadSceneImpl={loadSceneImpl}
          onEscapeEvidenceDismissed={() => setEscapeEvidenceDismissed(true)}
        />
      );
    } else {
      view = <FinalDoor escaped state={state} loadSceneImpl={loadSceneImpl} onOpenAutopsy={() => setAutopsyRequested(true)} />;
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
        loadSceneImpl={loadSceneImpl}
        showSampleLabel={binding.assets?.source !== 'notes'}
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
              side={controls.side}
            />
          )
        }
      />
    );
  } else {
    view = startView;
  }

  // The room screen draws its own label; every other screen of a run gets it here (Requirement 1.6).
  const showLabel =
    phase === 'running' &&
    state !== null &&
    binding.assets?.source !== 'notes' &&
    (state.status === 'escaped' || state.atFinalDoor);

  return (
    <>
      {showLabel ? <p className="room-screen__sample-label">{SAMPLE_CRYPT_LABEL}</p> : null}
      {phase === 'running' && state !== null ? <SaveBanner saveFailed={binding.saveFailed === true} /> : null}
      {view}
      {isGenerating(generationState) ? null : <LiveRegion messages={messages} />}
    </>
  );
}

/** Owns the room binding and routes between the start view, the room, the final door, the escape view and the Autopsy. */
export function CryptFlow(props: CryptFlowProps): ReactNode {
  return (
    <CryptErrorBoundary>
      <LanternProvider>
        <CryptFlowInner {...props} />
      </LanternProvider>
    </CryptErrorBoundary>
  );
}
