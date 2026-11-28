import type { ReactNode } from 'react';
import type { RoomAction } from '../../state/room-actions';
import type { RoomBinding } from '../../state/room-binding';
import { AutopsyView } from './autopsy-view';
import { StartFailed } from './crypt-start-failed';
import { FinalDoor } from './final-door';
import { RoomPanel } from './room-panel';
import { RoomScreen } from './room-screen';
import type { SceneLoader } from './use-scene';

export interface CryptRunViewProps {
  readonly binding: RoomBinding;
  readonly dispatch: (action: RoomAction) => void;
  /** What shows while no run is playing. */
  readonly startView: ReactNode;
  readonly loadSceneImpl?: SceneLoader;
  readonly autopsyRequested: boolean;
  readonly onOpenAutopsy: () => void;
  /** View-only: true once the learner closed the Evidence_Panel of the escaping answer. */
  readonly escapeEvidenceDismissed: boolean;
  readonly onEscapeEvidenceDismissed: () => void;
  readonly announce: (message: string) => void;
  readonly sampleTitle: string;
}

/** Chooses the screen for the run: the start view, the room, the final door, the escape view or the Autopsy. */
export function CryptRunView({
  binding,
  dispatch,
  startView,
  loadSceneImpl,
  autopsyRequested,
  onOpenAutopsy,
  escapeEvidenceDismissed,
  onEscapeEvidenceDismissed,
  announce,
  sampleTitle,
}: CryptRunViewProps): ReactNode {
  const { state, notices, phase, startError } = binding;
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
      view = (
        <AutopsyView
          state={state}
          assets={binding.assets}
          dispatch={dispatch}
          announce={announce}
          sampleTitle={sampleTitle}
        />
      );
    } else if (evidenceStillOpen) {
      view = (
        <FinalDoor
          state={state}
          dispatch={dispatch}
          notices={binding.notices}
          assets={binding.assets}
          rejection={binding.rejection}
          eventLog={binding.eventLog}
          loadSceneImpl={loadSceneImpl}
          onEscapeEvidenceDismissed={() => onEscapeEvidenceDismissed()}
        />
      );
    } else {
      view = <FinalDoor escaped state={state} loadSceneImpl={loadSceneImpl} onOpenAutopsy={() => onOpenAutopsy()} />;
    }
  } else if (state.status === 'in progress') {
    view = state.atFinalDoor ? (
      <FinalDoor
        state={state}
        dispatch={dispatch}
        assets={binding.assets}
        rejection={binding.rejection}
        eventLog={binding.eventLog}
        loadSceneImpl={loadSceneImpl}
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
            />
          )
        }
      />
    );
  } else {
    view = startView;
  }

  return view;
}
