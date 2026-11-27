import { useCallback, useReducer } from 'react';
import { apply, initial } from '@escape-the-crypt/core';
import type {
  Event,
  Outcome_Notice,
  Result,
  SampleCryptError,
  SampleCryptResult,
  State,
  Typed_Rejection,
} from '@escape-the-crypt/core';
import type { EventRoomAction, RoomAction } from './room-actions';
import { stepBinding } from './room-binding-model';
import type { BindingModel } from './room-binding-model';
import { buildFirstQuestionByConcept } from './room-assets';
import type { CryptSource, RoomAssets } from './room-assets';
import { buildSampleCrypt } from './sample-crypt-source';
import type { RunLockState } from './storage/run-lock';
import type { RestoredRun } from './storage/restore-run';

/** A crypt ready to play. `source` is 'sample' when absent; a generated crypt says 'notes'. */
export type BuiltCrypt = SampleCryptResult & {
  readonly source?: CryptSource;
  /** Digest of the notes a generated crypt was made from; saved so a restore can rebuild citations. */
  readonly documentDigest?: string;
};
export type BuildCrypt = () => Result<BuiltCrypt, SampleCryptError>;
export type StartError = SampleCryptError | Typed_Rejection;

/** Fixed run settings (Requirement 5.1). */
export const RUN_SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 2 } as const;

export interface RoomBindingState {
  readonly phase: 'not-started' | 'running' | 'start-failed';
  readonly state: State | null;
  /** Read-only Event_Log for pure selectors such as `chosenOptionFor`. Empty until a run starts. */
  readonly eventLog: readonly Event[];
  readonly assets: RoomAssets | null;
  readonly notices: readonly Outcome_Notice[];
  readonly rejection: Typed_Rejection | null;
  readonly startError: StartError | null;
}

export interface RoomBinding extends RoomBindingState {
  readonly dispatch: (action: RoomAction) => void;
  /**
   * The notices of the latest accepted Event, as `useRoomBinding` produces them. The persisted
   * hook holds them back and passes them on as `notices` once the append has settled.
   */
  readonly heldNotices?: readonly Outcome_Notice[];
  /** Set by the persisted hook: true while an accepted Event is not stored. */
  readonly saveFailed?: boolean;
  /** Set by the persisted hook: re-attempts the oldest unsaved Event. */
  readonly retrySave?: () => void;
  /** Set by the persisted hook: id of the current run, once one has started. */
  readonly runId?: string;
  /** Set by the persisted hook: the run lock state (Req 9). cquiring until the first grant or refusal. */
  readonly lockState?: RunLockState;
  /** Set by the persisted hook: takes the run over and restores it from the database (Req 9.3). */
  readonly takeOver?: () => Promise<void>;
  /** Replaces the in-memory run with a restored one. */
  readonly restore?: (restored: RestoredRun) => void;
}

/** What the reducer holds: the public view's source plus the built crypt kept for `playAgain`. */
interface Store {
  readonly phase: RoomBindingState['phase'];
  readonly model: BindingModel | null;
  readonly crypt: BuiltCrypt | null;
  readonly assets: RoomAssets | null;
  readonly startError: StartError | null;
}

type StoreAction =
  | EventRoomAction
  | { readonly type: 'startRun'; readonly built: Result<BuiltCrypt, SampleCryptError> }
  | { readonly type: 'playAgain' }
  | { readonly type: 'restore'; readonly restored: RestoredRun };

const INITIAL_STORE: Store = { phase: 'not-started', model: null, crypt: null, assets: null, startError: null };

/** The four start Events in order (Requirement 5.2). */
function startEvents(crypt: BuiltCrypt): readonly Event[] {
  const { manifest } = crypt;
  const firstRoom = manifest.rooms[0]?.roomId ?? '';
  return [
    { kind: 'RunStarted', manifestId: manifest.manifestId },
    { kind: 'RoomPublished', roomId: firstRoom },
    { kind: 'CryptFinalised', finalRoomCount: 1 },
    { kind: 'RoomEntered', roomId: firstRoom },
  ];
}

/** Applies the start sequence to a fresh State. A rejected Event stops the run. */
function startModel(crypt: BuiltCrypt): Result<BindingModel, Typed_Rejection> {
  let state = initial(crypt.manifest, RUN_SETTINGS);
  const log: Event[] = [];
  for (const event of startEvents(crypt)) {
    const result = apply(state, event);
    if (!result.ok) return { ok: false, error: result.error };
    state = result.state;
    log.push(event);
  }
  return {
    ok: true,
    value: { manifest: crypt.manifest, eventLog: log, state, notices: [], rejection: null },
  };
}

function failed(error: StartError): Store {
  return { ...INITIAL_STORE, phase: 'start-failed', startError: error };
}

/** Starts a run against a built crypt. `assets` is reused when the crypt is the same one. */
function startFrom(crypt: BuiltCrypt, previous: RoomAssets | null): Store {
  const started = startModel(crypt);
  if (!started.ok) return failed(started.error);
  const assets: RoomAssets = previous ?? {
    source: crypt.source ?? 'sample',
    content: crypt.content,
    chunks: crypt.chunks,
    firstQuestionByConcept: buildFirstQuestionByConcept(crypt.manifest),
  };
  return { phase: 'running', model: started.value, crypt, assets, startError: null };
}

/** Pure reducer behind `useRoomBinding`. */
export function bindingReducer(store: Store, action: StoreAction): Store {
  switch (action.type) {
    case 'startRun':
      return action.built.ok ? startFrom(action.built.value, null) : failed(action.built.error);
    case 'playAgain':
      return store.crypt === null ? store : startFrom(store.crypt, store.assets);
    case 'restore': {
      const { model, assets, crypt } = action.restored;
      const built: BuiltCrypt = {
        manifest: model.manifest,
        content: crypt.content,
        chunks: assets.chunks,
        source: assets.source,
        ...(crypt.documentDigest === undefined ? {} : { documentDigest: crypt.documentDigest }),
      };
      return { phase: 'running', model, crypt: built, assets, startError: null };
    }
    default:
      if (store.model === null) return store;
      return { ...store, model: stepBinding(store.model, action) };
  }
}

const NO_EVENTS: readonly Event[] = [];
const NO_NOTICES: readonly Outcome_Notice[] = [];

export function useRoomBinding(buildCrypt: BuildCrypt = buildSampleCrypt): RoomBinding {
  const [store, send] = useReducer(bindingReducer, INITIAL_STORE);
  const dispatch = useCallback(
    (action: RoomAction): void => {
      send(action.type === 'startRun' ? { type: 'startRun', built: buildCrypt() } : action);
    },
    [buildCrypt],
  );
  const restore = useCallback((restored: RestoredRun): void => send({ type: 'restore', restored }), []);
  return {
    restore,
    phase: store.phase,
    state: store.model?.state ?? null,
    eventLog: store.model?.eventLog ?? NO_EVENTS,
    assets: store.assets,
    notices: store.model?.notices ?? NO_NOTICES,
    heldNotices: store.model?.notices ?? NO_NOTICES,
    rejection: store.model?.rejection ?? null,
    startError: store.startError,
    dispatch,
  };
}
