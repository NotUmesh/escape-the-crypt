import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ESCAPE_COPY, ROOM_PLAY_LABELS, selectFinalDoor } from '@escape-the-crypt/core';
import type { Event, Outcome_Notice, State, Typed_Rejection } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import type { RoomAssets } from '../../state/room-assets';
import { doorButtonName, sealName } from './accessible-names';
import type { Viewport } from './crop-mapping';
import { DoorStage } from './door-stage';
import { LockCloseUp } from './lock-closeup';
import { isPhoneViewport } from './scene-layout';
import { SealList } from './final-door-seals';
import { placeSeals } from './seal-layout';
import { LOCK_PANELS } from './lock-panel-registry';
import { RoomPanel } from './room-panel';
import { UnplayablePanel } from './unplayable-panel';
import { useRoomArt } from './use-room-art';
import type { SceneLoader } from './use-scene';
import './final-door.css';

/** Test and layout hooks shared by both door views. */
export interface FinalDoorArtProps {
  /** Loads the Scene_File. Tests inject one. */
  readonly loadSceneImpl?: SceneLoader;
  /** Window size for phone framing. The real window when omitted. */
  readonly viewport?: Viewport;
}
export interface EscapedFinalDoorProps extends FinalDoorArtProps {
  readonly escaped: true;
  /** The run's State, to draw the room art behind the escape message. Without it only the message shows. */
  readonly state?: State;
  /** Asks the flow to show the Autopsy. */
  readonly onOpenAutopsy: () => void;
}

export interface PlayingFinalDoorProps extends FinalDoorArtProps {
  readonly escaped?: false;
  readonly notices?: readonly Outcome_Notice[];
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
  readonly assets: RoomAssets | null;
  readonly rejection: Typed_Rejection | null;
  readonly eventLog: readonly Event[];
  /**
   * Called when the learner dismisses the Evidence_Panel of the answer that escaped the run.
   * That Continue is local: it dispatches no Event, because the runtime rejects Events after the escape.
   */
  readonly onEscapeEvidenceDismissed?: () => void;
}

export type FinalDoorProps = EscapedFinalDoorProps | PlayingFinalDoorProps;

const CLOSED_TEXT = 'The final door is closed.';
const OPEN_TEXT = 'The final door is open.';

/** The final door: closed until available, then one seal per slot. Adds no game rule. */
export function FinalDoor(props: FinalDoorProps): ReactNode {
  if (props.escaped === true) return <EscapedDoor {...props} />;
  return <PlayingDoor {...props} />;
}

/** The escape view: the escape message and one button. No slots, panel or help controls. */
function EscapedDoor({ onOpenAutopsy, state, loadSceneImpl, viewport }: EscapedFinalDoorProps): ReactNode {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The view replaces the door or the dismissed Evidence_Panel, so focus would otherwise be lost.
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);
  return (
    <section className="final-door final-door--escaped" data-testid="escape-view">
      {state === undefined ? null : <EscapeArt state={state} loadSceneImpl={loadSceneImpl} viewport={viewport} />}
      <p>{ESCAPE_COPY.message}</p>
      <button ref={buttonRef} type="button" className="final-door__button" onClick={onOpenAutopsy}>
        {ROOM_PLAY_LABELS.openAutopsy}
      </button>
    </section>
  );
}

/** The open door with its light behind the escape message. */
function EscapeArt({ state, loadSceneImpl, viewport }: { readonly state: State } & FinalDoorArtProps): ReactNode {
  const art = useRoomArt(state, loadSceneImpl);
  return <DoorStage art={art} state={state} viewport={viewport} />;
}

function PlayingDoor({
  state,
  dispatch,
  assets,
  rejection,
  eventLog,
  onEscapeEvidenceDismissed,
  notices,
  loadSceneImpl,
  viewport,
}: PlayingFinalDoorProps): ReactNode {
  const art = useRoomArt(state, loadSceneImpl);
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const door = selectFinalDoor(state);
  const playing = state.status === 'in progress';

  const escaped = state.status === 'escaped';

  function close(): void {
    setOpenSlotId(null);
    if (escaped) {
      // The escape view takes over and moves focus to its own button.
      onEscapeEvidenceDismissed?.();
      return;
    }
    const opener = openerRef.current;
    if (opener !== null && opener.isConnected) opener.focus();
    else document.querySelector<HTMLElement>('.final-door__seal-button')?.focus();
  }

  function openSeal(slotId: string, opener: HTMLButtonElement): void {
    openerRef.current = opener;
    dispatch({ type: 'openLock', slotId });
    setOpenSlotId(slotId);
  }
  if (!door.available) {
    return (
      <section className="final-door" data-testid="final-door">
        <p>{CLOSED_TEXT}</p>
      </section>
    );
  }

  if (!state.atFinalDoor) {
    return (
      <section className="final-door" data-testid="final-door">
        <p>{OPEN_TEXT}</p>
        {playing ? (
          <button
            type="button"
            className="final-door__button"
            aria-label={doorButtonName()}
            onClick={() => dispatch({ type: 'enterFinalDoor' })}
          >
            {doorButtonName()}
          </button>
        ) : null}
      </section>
    );
  }

  // After the escape no seal can be opened, so the slot to show is the one whose Evidence_Panel is still open.
  const openSlot = escaped
    ? state.finalDoor.slots.find((s) => s.evidencePanelOpen)
    : state.finalDoor.slots.find((s) => s.slotId === openSlotId && (s.status === 'open' || s.evidencePanelOpen));

  return (
    <section className="final-door" data-testid="final-door">
      <p>{OPEN_TEXT}</p>
      {/* While the scene loads no seal is drawn, so a click cannot land on a seal that is about to move. */}
      {art.sceneState.status === 'loading' ? null : art.sceneState.status === 'ready' && art.artRoom !== null ? (
        <DoorStage
          art={art}
          state={state}
          notices={notices}
          viewport={viewport}
          overlay={(layout) => {
            const points = placeSeals(layout.door.polygon, door.slots.length);
            const list = <SealList slots={door.slots} playing={playing} points={points} onOpen={openSeal} />;
            // A door too small for every control keeps the plain list, laid over the foot of the stage.
            return points === null ? <div className="final-door__seals-fallback">{list}</div> : list;
          }}
        />
      ) : (
        <SealList slots={door.slots} playing={playing} points={null} onOpen={openSeal} />
      )}
      <div className="final-door__panel-slot" data-testid="panel-slot">
        {openSlot === undefined || assets === null ? null : LOCK_PANELS[openSlot.currentQuestionType] === undefined ? (
          <UnplayablePanel
            slotId={openSlot.slotId}
            heading={sealName(state.finalDoor.slots.indexOf(openSlot) + 1, openSlot.status)}
            dispatch={dispatch}
            onClose={close}
          />
        ) : (
          <LockCloseUp
            lockType={openSlot.currentQuestionType}
            solved={openSlot.status === 'solved'}
            side="right"
            phone={isPhoneViewport(viewport ?? { width: window.innerWidth, height: window.innerHeight })}
            log={art.log}
          >
            <RoomPanel
              slot={openSlot}
              state={state}
              side="right"
              heading={sealName(state.finalDoor.slots.indexOf(openSlot) + 1, openSlot.status)}
              assets={assets}
              rejection={rejection}
              eventLog={eventLog}
              dispatch={dispatch}
              openerRef={openerRef}
              onClose={close}
              continueLocally={escaped}
            />
          </LockCloseUp>
        )}
      </div>
    </section>
  );
}
