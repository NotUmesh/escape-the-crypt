import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GENERATION_COPY, SAMPLE_CRYPT_LABEL } from '@escape-the-crypt/core';
import type { RunSettings } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { usePersistedRoomBinding } from '../../state/persisted-room';
import { RUN_SETTINGS } from '../../state/room-binding';
import type { BuildCrypt, BuiltCrypt, RoomBinding } from '../../state/room-binding';
import { isGenerating } from '../generate/generation-flow';
import { resolveClient, resolveOrigin } from '../generate/generate-seams';
import type { GenerateSeams } from '../generate/generate-seams';
import { useGeneration } from '../generate/use-generation';
import { EMPTY_TRACKER, announceStep } from './announce-step';
import type { AnnounceTracker } from './announce-step';
import { CryptErrorBoundary } from './crypt-error-boundary';
import { DescentLayer, useDescent } from './crypt-descent';
import { CryptRunView } from './crypt-run-view';
import { buildCryptForSample } from './sample-sources';
import type { RenderStart } from './crypt-start-context';
import { RunConflictNotice } from './conflict-notice';
import { useGeneratedNotices } from './use-generated-notices';
import { useEndgameClips } from './use-endgame-clips';
import { LiveRegion } from './live-region';
import { LockAnnounceContext } from './lock-panel-payload';
import { ReadOnlyScreenContainer } from '../start/read-only-screen';
import { SaveBanner } from '../start/save-banner';
import { exportSlotFor } from '../start/export-control';
import { createIdbStore } from '../ingest/notes-store-idb';
import type { RestoreDeps, RestoredRun } from '../../state/storage/restore-run';
import { ResumeEntry } from '../start/resume-entry';
import { StartView } from './start-view';
import { SettingsSlot } from '../desk/settings-slot';
import { useRunChoice } from '../desk/use-run-choice';
import type { SceneLoader } from './use-scene';
import { DEFAULT_SAMPLE_ID, sampleTitleFor } from '../desk/sample-list';
import './crypt-stage.css';

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
  /** What the read-only screen restores from. Defaults to the browser's IndexedDB. */
  readonly restoreDeps?: RestoreDeps;
  /**
   * Builds the screens before the crypt (desk, notes book, dig) in place of the built-in start
   * view. When set, a newly started run also plays the descent, and the room's live region
   * exists only while a run is playing, because the host's announcer covers the screens before it.
   */
  readonly renderStart?: RenderStart;
  /** Reads the judge access code the host holds in memory. Used only when a job starts. */
  readonly judgeCode?: () => string;
}

const NO_MESSAGES: readonly string[] = [];

function CryptFlowInner({ useBinding = usePersistedRoomBinding, loadSceneImpl, notesText, notesDigest, generate, onAnnounce, restoreDeps, renderStart, judgeCode }: CryptFlowProps): ReactNode {
  // Which crypt startRun builds: the generated one once it is ready, else the sample.
  const playRef = useRef<BuiltCrypt | null>(null);
  // The sample the learner chose on the shelf; the default when none was chosen.
  const playedSample = useRef<string | undefined>(undefined);
  // The sample's settings are read when the run starts, so the latest difficulty choice applies.
  const sampleSettings = useRef(() => RUN_SETTINGS);
  const buildCrypt = useCallback<BuildCrypt>(() => {
    if (playRef.current !== null) return { ok: true, value: playRef.current };
    const sample = buildCryptForSample(playedSample.current ?? DEFAULT_SAMPLE_ID)();
    return sample.ok ? { ok: true, value: { ...sample.value, settings: sampleSettings.current() } } : sample;
  }, []);
  const binding = useBinding(buildCrypt);
  const origin = resolveOrigin(generate);
  const client = useMemo(() => resolveClient(generate, origin, judgeCode), [generate, origin, judgeCode]);
  const generation = useGeneration({
    client,
    intervalMs: generate?.intervalMs,
    maxPolls: generate?.maxPolls,
    newKey: generate?.newKey,
  });
  const canGenerate = origin !== null && notesText !== undefined;
  const choice = useRunChoice(notesText, canGenerate);
  sampleSettings.current = () => choice.settingsFor('sample');
  const { state, notices, phase } = binding;
  const descent = useDescent(renderStart !== undefined);
  const beginDescent = descent.begin;
  const [autopsyRequested, setAutopsyRequested] = useState(false);
  // View-only flag: true once the learner closed the Evidence_Panel of the escaping answer. Holds no game state.
  const [escapeEvidenceDismissed, setEscapeEvidenceDismissed] = useState(false);
  const completeEscape = useEndgameClips(
    state,
    binding.eventLog,
    binding.assets !== null && (state?.finalDoor.slots.some((slot) => slot.evidencePanelOpen) ?? false),
    beginDescent,
  );
  const [messages, setMessages] = useState<readonly string[]>(NO_MESSAGES);
  const announceFromPanel = useCallback((message: string): void => setMessages([message]), []);
  const previous = useRef<AnnounceTracker>(EMPTY_TRACKER);

  const bindingDispatch = binding.dispatch;
  const dispatch = useCallback(
    (action: RoomAction): void => {
      if (action.type === 'playAgain') {
        setAutopsyRequested(false);
        setEscapeEvidenceDismissed(false);
        // A new run is not a step from the old State, so nothing is announced for it.
        previous.current = EMPTY_TRACKER;
      }
      bindingDispatch(action);
    },
    [bindingDispatch],
  );

  // A new State announces its step; notices released a render later (saved runs) are announced then.
  useEffect(() => {
    const step = announceStep(previous.current, state, notices);
    previous.current = step.tracker;
    if (step.messages.length > 0) setMessages(step.messages);
  }, [state, notices]);

  const deps = useMemo<RestoreDeps>(() => {
    if (restoreDeps !== undefined) return restoreDeps;
    const factory = typeof indexedDB === 'undefined' ? undefined : indexedDB;
    return { factory, notesStore: createIdbStore(factory) };
  }, [restoreDeps]);
  const takeOver = binding.takeOver;
  const onTakeOver = useCallback((): void => {
    void takeOver?.();
  }, [takeOver]);

  const startSample = useCallback(
    (sampleId?: string): void => {
      playRef.current = null;
      playedSample.current = sampleId;
      beginDescent('clips');
      dispatch({ type: 'startRun' });
    },
    [dispatch, beginDescent],
  );
  const generationState = generation.state;
  const readyCrypt = generation.crypt;
  const heldNotices = useGeneratedNotices(generationState.status, readyCrypt);
  // A finished job starts room 1 of the generated crypt through the same binding as the sample.
  useEffect(() => {
    if (generationState.status !== 'ready') return;
    const crypt = readyCrypt();
    if (crypt === null) return;
    playRef.current = crypt;
    beginDescent('clips');
    bindingDispatch({ type: 'startRun' });
  }, [generationState, readyCrypt, bindingDispatch, beginDescent]);
  // The stopped message is read through the host's announcer, not a region here. The progress line is
  // read by the host's dig screen, once, so it is not sent from here as well.
  const generationStatus = generationState.status;
  const hosted = renderStart !== undefined;
  useEffect(() => {
    if (onAnnounce === undefined) return;
    if (generationStatus === 'cancelled') onAnnounce(GENERATION_COPY.cancelled);
    else if (!hosted && (generationStatus === 'starting' || generationStatus === 'polling')) {
      onAnnounce(GENERATION_COPY.progress);
    } else if (hosted && generationStatus === 'idle') {
      // Nothing to say, and a message from the notes book must not be cleared.
    } else if (generationStatus !== 'starting' && generationStatus !== 'polling') onAnnounce('');
  }, [generationStatus, onAnnounce, hosted]);
  const restoreBinding = binding.restore;
  const onResume = useCallback(
    (restored: RestoredRun): void => {
      // Continuing goes straight in: a short fade, not the clips.
      beginDescent('fade');
      restoreBinding?.(restored);
    },
    [restoreBinding, beginDescent],
  );
  // Start again on the same crypt: a generated crypt is rebuilt from its notes, else the sample plays.
  const onStartAgainSaved = useCallback(
    (crypt: BuiltCrypt | null, settings?: RunSettings): void => {
      playRef.current = crypt === null || settings === undefined ? crypt : { ...crypt, settings };
      if (crypt === null && settings !== undefined) sampleSettings.current = () => settings;
      beginDescent('clips');
      dispatch({ type: 'startRun' });
    },
    [dispatch, beginDescent],
  );
  const onGenerate = (): void => generation.start(notesText ?? '', notesDigest, choice.settingsFor('generated'));
  const startView = renderStart !== undefined ? (
    renderStart({
      generation: generationState,
      canGenerate,
      choice,
      onGenerate,
      onCancelGeneration: generation.cancel,
      playSample: startSample,
      deps,
      onContinue: onResume,
      onStartAgain: onStartAgainSaved,
    })
  ) : (
    <StartView
      resume={<ResumeEntry deps={deps} onContinue={onResume} onStartAgain={onStartAgainSaved} />}
      onEnter={() => startSample()}
      settings={<SettingsSlot value={choice.value} onChange={choice.onChange} availability={choice.availability} />}
      generation={
        canGenerate
          ? {
              state: generationState,
              onGenerate,
              onCancel: generation.cancel,
              onPlaySample: () => startSample(),
            }
          : undefined
      }
    />
  );
  const view = (
    <CryptRunView
      binding={binding}
      dispatch={dispatch}
      startView={startView}
      loadSceneImpl={loadSceneImpl}
      autopsyRequested={autopsyRequested}
      onOpenAutopsy={() => setAutopsyRequested(true)}
      escapeEvidenceDismissed={escapeEvidenceDismissed}
      onEscapeEvidenceDismissed={() => {
        completeEscape();
        setEscapeEvidenceDismissed(true);
      }}
      announce={announceFromPanel}
      sampleTitle={sampleTitleFor(playedSample.current)}
    />
  );

  // The room screen draws its own label; every other screen of a run gets it here (Requirement 1.6).
  const showLabel =
    phase === 'running' &&
    state !== null &&
    binding.assets?.source !== 'notes' &&
    (state.status === 'escaped' || state.atFinalDoor);

  // A run that could not start has no descent to wait for.
  const endDescent = descent.end;
  const descentVariant = descent.variant;
  useEffect(() => {
    if (phase === 'start-failed' && descentVariant !== null) endDescent();
  }, [phase, descentVariant, endDescent]);

  // Another tab owns the run: show it read-only. cquiring (first grant pending) shows the normal screen.
  // This return comes after every hook above.
  const lockState = binding.lockState;
  if ((lockState === 'waiting' || lockState === 'lost') && binding.runId !== undefined) {
    const readOnly = <ReadOnlyScreenContainer deps={deps} runId={binding.runId} onTakeOver={onTakeOver} />;
    return renderStart === undefined ? readOnly : <main className="screen">{readOnly}</main>;
  }

  const body = (
    <>
      {showLabel ? <p className="room-screen__sample-label">{SAMPLE_CRYPT_LABEL}</p> : null}
      {phase === 'running' && state !== null ? (
        <SaveBanner
          saveFailed={binding.saveFailed === true}
          exportSlot={exportSlotFor(binding, state, deps, renderStart === undefined ? undefined : announceFromPanel)}
        />
      ) : null}
      <RunConflictNotice
        held={heldNotices}
        state={state}
        running={phase === 'running'}
        announce={announceFromPanel}
        ready={descent.variant === null}
      />
      <LockAnnounceContext.Provider value={announceFromPanel}>{view}</LockAnnounceContext.Provider>
    </>
  );
  // With a host start screen the room's region exists only while a run plays; the host's announcer covers the rest.
  const showRegion = renderStart === undefined ? !isGenerating(generationState) : phase === 'running';
  return (
    <>
      {renderStart === undefined ? (
        body
      ) : (
        <DescentLayer variant={phase === 'running' ? descent.variant : null} onDone={descent.end} announce={announceFromPanel} landmark={phase !== 'not-started'}>
          {body}
        </DescentLayer>
      )}
      {showRegion ? <LiveRegion messages={messages} /> : null}
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
