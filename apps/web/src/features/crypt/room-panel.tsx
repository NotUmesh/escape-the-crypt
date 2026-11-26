import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import type {
  Event,
  FinalDoorSlotState,
  LockSlotState,
  ReturnSlotState,
  State,
  Typed_Rejection,
} from '@escape-the-crypt/core';
import type { RoomAssets } from '../../state/room-assets';
import type { RoomAction } from '../../state/room-actions';
import { lockName, returnSlotName } from './accessible-names';
import { LockPanelContext } from './lock-panel-context';
import type { LockPanelContextValue } from './lock-panel-context';
import { EvidencePanel } from './evidence-panel';
import { QuestionControls } from './question-controls';
import { QuestionPanel } from './question-panel';

export interface RoomPanelProps {
  readonly slot: LockSlotState | ReturnSlotState | FinalDoorSlotState;
  readonly state: State;
  /** Placement for the layered art; the final door passes "right". */
  readonly side?: 'left' | 'right';
  /** Overrides the heading, for a final-door slot that has no lock or return name. */
  readonly heading?: string;
  readonly assets: RoomAssets;
  readonly rejection: Typed_Rejection | null;
  /** The binding's read-only Event_Log, used to find the option the learner chose. */
  readonly eventLog: readonly Event[];
  readonly dispatch: (action: RoomAction) => void;
  readonly openerRef: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
}

/** The Question_Panel for an opened Lock_Slot, with the context the lock panels read. */
/** The key option of a s�ance question, read from the manifest payload; undefined for other types. */
export function keyOptionIdFor(state: State, questionId: string): string | undefined {
  for (const room of state.manifest.rooms) {
    for (const spec of room.lockSlots) {
      for (const q of [spec.primaryQuestion, spec.alternateQuestion]) {
        if (q !== null && q.questionId === questionId) return seanceKey(q.lockType, q.payload);
      }
    }
  }
  for (const door of state.manifest.finalDoor.slots) {
    if (door.question.questionId === questionId) return seanceKey(door.question.lockType, door.question.payload);
  }
  return undefined;
}

function seanceKey(lockType: string, payload: unknown): string | undefined {
  if (lockType !== 'seance-board' || typeof payload !== 'object' || payload === null) return undefined;
  const key = (payload as { readonly keyOptionId?: unknown }).keyOptionId;
  return typeof key === 'string' ? key : undefined;
}

export function RoomPanel({
  slot,
  state,
  side,
  heading,
  assets,
  rejection,
  eventLog,
  dispatch,
  openerRef,
  onClose,
}: RoomPanelProps): ReactNode {
  const evidenceRef = useRef<HTMLElement>(null);
  const evidenceOpen = slot.evidencePanelOpen;
  useEffect(() => {
    if (evidenceOpen) evidenceRef.current?.focus();
  }, [evidenceOpen]);

  const value = useMemo<LockPanelContextValue>(
    () => ({
      dispatch,
      rejection,
      content: assets.content,
      appliedHintFor: (slotId) => {
        for (const room of state.rooms) {
          const found =
            room.lockSlots.find((s) => s.slotId === slotId) ?? room.dueReturnSlots.find((s) => s.slotId === slotId);
          if (found !== undefined) return found.appliedHint;
        }
        return state.finalDoor.slots.find((s) => s.slotId === slotId)?.appliedHint ?? null;
      },
    }),
    [dispatch, rejection, assets.content, state.rooms, state.finalDoor.slots],
  );

  if (evidenceOpen) {
    return (
      <EvidencePanel
        slot={slot}
        content={assets.content}
        chunks={assets.chunks}
        eventLog={eventLog}
        keyOptionId={keyOptionIdFor(state, slot.currentQuestionId)}
        panelRef={evidenceRef}
        onContinue={() => {
          dispatch({ type: 'continueEvidence', slotId: slot.slotId });
          onClose();
        }}
      />
    );
  }

  return (
    <LockPanelContext.Provider value={value}>
      <QuestionPanel
        slotId={slot.slotId}
        questionId={slot.currentQuestionId}
        questionType={slot.currentQuestionType}
        side={side}
        heading={
          heading ??
          ('stationType' in slot
            ? lockName(slot.stationType, slot.status)
            : returnSlotName(slot.label === 'review', slot.status))
        }
        open
        openerRef={openerRef}
        onClose={onClose}
        awaitingContinue={slot.evidencePanelOpen}
      >
        {slot.status === 'open' && !slot.evidencePanelOpen ? (
          <QuestionControls
            slotId={slot.slotId}
            remainingHints={state.remainingHints}
            hintApplied={slot.appliedHint?.questionId === slot.currentQuestionId}
            dispatch={dispatch}
            onClose={onClose}
          />
        ) : null}
      </QuestionPanel>
    </LockPanelContext.Provider>
  );
}
