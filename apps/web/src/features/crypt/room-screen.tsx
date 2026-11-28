import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import {
  LOCK_OBJECT_NAMES,
  ROOM_PLAY_LABELS,
  SAMPLE_CRYPT_LABEL,
  SLOT_STATUS_WORDS,
  cryptTargetFor,
  roomDisplayName,
  selectFinalDoor,
} from '@escape-the-crypt/core';
import type { LockSlotState, Outcome_Notice, ReturnSlotState, State } from '@escape-the-crypt/core';
import type { RoomAction } from '../../state/room-actions';
import { CandleIcon } from '../costume/ornaments';
import { doorButtonName, lockName, returnSlotName } from './accessible-names';
import { ArtStage } from './art-stage';
import type { Viewport } from './crop-mapping';
import type { Box } from './hotspot-geometry';
import { drawnGhosts } from './drawn-ghosts';
import { GhostList } from './ghost-list';
import { LockOverlay } from './lock-overlay';
import { useRoomArt } from './use-room-art';
import type { SceneLoader } from './use-scene';
import './room-screen.css';

const NO_NOTICES: readonly Outcome_Notice[] = [];

/** What the room screen hands the panel: the opener to refocus and a close that sends no Event. */
export interface PanelControls {
  readonly openerRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

export interface RoomScreenProps {
  readonly state: State;
  readonly dispatch: (action: RoomAction) => void;
  /** Fills the panel slot for the opened lock. Later tasks pass the Question_Panel here. */
  /** Notices from the latest accepted dispatch (Room_Binding). */
  readonly notices?: readonly Outcome_Notice[];
  /** Loads the Scene_File. Tests inject one; the default fetches /art/rooms/<art-room>/scene.json. */
  readonly loadSceneImpl?: SceneLoader;
  /** Window size for phone framing. The real window when omitted. */
  readonly viewport?: Viewport;
  /** False for a generated crypt, which is not the sample. Defaults to true. */
  readonly showSampleLabel?: boolean;
  readonly renderPanel?: (slot: LockSlotState | ReturnSlotState, controls: PanelControls) => ReactNode;
}

/** The current room as one native button per Lock_Slot, in slot order (Requirements 10.1, 10.2, 10.3).
 * While the Scene_File loads no lock button is drawn, so a click cannot land on a button that is about to be replaced. */
export function RoomScreen({ state, dispatch, notices = NO_NOTICES, renderPanel, loadSceneImpl, viewport, showSampleLabel = true }: RoomScreenProps): ReactNode {
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('');
  const [hasOpenedLock, setHasOpenedLock] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  const roomIndex = state.rooms.findIndex((r) => r.roomId === state.currentRoomId);
  const slots = room?.lockSlots ?? [];
  const { artRoom, log, sceneState, drawn, plain } = useRoomArt(state, loadSceneImpl);
  const rooms = state.finalRoomCount ?? state.rooms.length;
  // A generated crypt (no sample label) with fewer rooms than its length asked for.
  const requested = cryptTargetFor(state.settings.length).rooms;
  const shortened = !showSampleLabel && rooms < requested;
  const nextRoom = room?.cleared === true ? state.rooms[roomIndex + 1] : undefined;
  const canGoOn = nextRoom !== undefined && nextRoom.published && roomIndex + 1 < rooms;
  const canEnterDoor = selectFinalDoor(state).available && !state.atFinalDoor;
  const showEntranceHint = !hasOpenedLock && roomIndex === 0 && slots.length > 0 && slots.every((s) => s.status === 'open');
  // A new room moves focus to its title, so a keyboard or screen-reader user starts at the top.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shownRoom = useRef(state.currentRoomId);
  useEffect(() => {
    if (shownRoom.current === state.currentRoomId) return;
    shownRoom.current = state.currentRoomId;
    titleRef.current?.focus();
  }, [state.currentRoomId]);
  const ghosts = drawnGhosts(state);
  const spiritCandleCount =
    (room?.spiritCandles.length ?? 0) + (state.atFinalDoor ? state.finalDoor.spiritCandles.length : 0);
  // A judged slot is no longer `open`, but its panel stays until the learner continues from the evidence.
  const returnSlots = room?.dueReturnSlots ?? [];
  const openSlot: LockSlotState | ReturnSlotState | undefined = [...slots, ...returnSlots].find(
    (s) => s.slotId === openSlotId && (s.status === 'open' || s.evidencePanelOpen),
  );

  // A cracked seal on a challenged slot closes its panel (Req 16.9). On an open slot the panel stays,
  // and its key change shows the Alternate with a fresh draft and focus on the heading (Req 16.8).
  useEffect(() => {
    const cracked = notices.filter((n) => n.kind === 'sealCracked').map((n) => n.slotId);
    if (cracked.length === 0) return;
    const challenged = slots.find((s) => s.slotId === openSlotId && s.status === 'challenged');
    if (challenged === undefined || !cracked.includes(challenged.slotId)) return;
    setOpenSlotId(null);
  }, [notices, slots, openSlotId]);

  useLayoutEffect(() => {
    if (openSlotId !== null || openerRef.current === null) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener.isConnected) opener.focus();
    else titleRef.current?.closest('.room-screen')?.querySelector<HTMLElement>('.room-screen__lock-button')?.focus();
  }, [openSlotId]);

  function close(): void {
    setOpenSlotId(null);
  }

  function activate(slot: LockSlotState | ReturnSlotState, opener: HTMLElement): void {
    if (slot.status !== 'open') {
      setStatusText(SLOT_STATUS_WORDS[slot.status]);
      return;
    }
    setStatusText('');
    setHasOpenedLock(true);
    openerRef.current = opener;
    dispatch({ type: 'openLock', slotId: slot.slotId });
    setOpenSlotId(slot.slotId);
  }

  const scene = sceneState.status === 'ready' ? sceneState.scene : null;
  const hasStage = scene !== null && artRoom !== null && drawn.length > 0;
  let panel: ReactNode = null;
  if (openSlot !== undefined && renderPanel !== undefined) {
    const content = renderPanel(openSlot, { openerRef, onClose: close });
    if (content !== null) {
      const concept = 'conceptId' in openSlot
        ? openSlot.conceptId
        : state.manifest.rooms[roomIndex]?.lockSlots.find((slot) => slot.slotId === openSlot.slotId)?.conceptId;
      panel = (
        <LockOverlay
          heading={LOCK_OBJECT_NAMES[openSlot.currentQuestionType]?.kind ?? ROOM_PLAY_LABELS.unplayableType}
          lockType={openSlot.currentQuestionType}
          solved={openSlot.status === 'solved'}
          evidence={openSlot.evidencePanelOpen}
          ghostRises={openSlot.evidencePanelOpen && notices.some((notice) => notice.kind === 'ghostSpawned' && notice.conceptId === concept)}
          hints={state.settings.hintAllowance > 0 ? state.remainingHints : null}
          log={log}
          onClose={close}
        >
          {content}
        </LockOverlay>
      );
    }
  }

  function exits(box?: Box): ReactNode {
    if (!canGoOn && !canEnterDoor) return null;
    return (
      <div
        className={`room-screen__exits${box === undefined ? '' : ' room-screen__exits--placed'}`}
        style={box === undefined ? undefined : {
          '--exit-x': `${box.x + box.width / 2}px`,
          '--exit-y': `${box.y + box.height * 0.75}px`,
        } as CSSProperties}
      >
        {canGoOn ? (
          <button type="button" className="room-screen__next-room costume-seal" onClick={() => dispatch({ type: 'enterRoom', roomId: nextRoom.roomId })}>
            {ROOM_PLAY_LABELS.nextRoom}
          </button>
        ) : null}
        {canEnterDoor ? (
          <button
            type="button"
            className={`room-screen__door-button${canGoOn ? '' : ' costume-seal'}`}
            aria-label={doorButtonName()}
            onClick={() => dispatch({ type: 'enterFinalDoor' })}
          >
            {doorButtonName()}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="room-screen" aria-labelledby="room-screen-title">
      <div className={`room-screen__scene${hasStage ? ' room-screen__scene--full-bleed' : ''}`}>
        <header className="costume-stone room-screen__hud">
          <h1 id="room-screen-title" className="room-screen__title" ref={titleRef} tabIndex={-1}>
            {room === undefined ? '' : roomDisplayName(roomIndex)}
          </h1>
          <div className="room-screen__hud-progress">
            {roomIndex >= 0 ? <p className="room-screen__position">{ROOM_PLAY_LABELS.roomOf(roomIndex + 1, rooms)}</p> : null}
            {state.settings.hintAllowance > 0 ? (
              <p className="room-screen__hints">
                <CandleIcon lit={state.remainingHints > 0} />{ROOM_PLAY_LABELS.hintsLeft(state.remainingHints)}
              </p>
            ) : null}
            <span className="room-screen__candles" aria-hidden="true">
              {slots.map((slot) => <CandleIcon key={slot.slotId} lit={slot.candleLit} />)}
            </span>
          </div>
          {shortened && roomIndex === 0 ? (
            <p className="room-screen__shortened" data-testid="crypt-shortened">
              {ROOM_PLAY_LABELS.cryptShortened(rooms, requested)}
            </p>
          ) : null}
          {showSampleLabel ? <p className="room-screen__sample-label">{SAMPLE_CRYPT_LABEL}</p> : null}
          {showEntranceHint ? <p className="room-screen__entrance-hint">{ROOM_PLAY_LABELS.chooseLock}</p> : null}
        </header>
        {hasStage ? (
          <ArtStage
            key={room?.roomId}
            artRoom={artRoom}
            scene={scene}
            slots={drawn}
            cleared={room?.cleared ?? false}
            roomId={room?.roomId}
            log={log}
            onActivate={activate}
            notices={notices}
            ghosts={ghosts}
            spiritCandleCount={spiritCandleCount}
            viewport={viewport}
            fullBleed
            exit={({ box }) => exits(box)}
          />
        ) : null}
      </div>
      <div className="room-screen__details">
        {plain.length > 0 ? (
          <ul className="room-screen__locks">
            {plain.map((slot) => (
              <li key={slot.slotId} className="room-screen__lock">
                <button
                  type="button"
                  className="room-screen__lock-button"
                  data-status={slot.status}
                  aria-label={lockName(slot.stationType, slot.status)}
                  onClick={(event) => activate(slot, event.currentTarget)}
                >
                  {lockName(slot.stationType, slot.status)}
                </button>
                {slot.status === 'challenged' ? (
                  <span className="room-screen__challenged">{ROOM_PLAY_LABELS.challengedLabel}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {returnSlots.length > 0 ? (
          <ul className="room-screen__returns" data-testid="return-slots">
            {returnSlots.map((slot) => {
              const name = returnSlotName(slot.label === 'review', slot.status);
              return (
                <li key={slot.slotId} className="room-screen__lock">
                  <button
                    type="button"
                    className="room-screen__return-button"
                    data-status={slot.status}
                    aria-label={name}
                    onClick={(event) => activate(slot, event.currentTarget)}
                  >
                    {name}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {hasStage ? null : exits()}
        <GhostList ghosts={ghosts} spiritCandleCount={spiritCandleCount} />
        <p className="room-screen__status" data-testid="slot-status">
          {statusText}
        </p>
      </div>
      <div className="room-screen__panel-slot" data-testid="panel-slot">
        {panel}
      </div>
    </section>
  );
}
