import type { LockType } from '../types';
import type {
  AppliedHintState,
  FinalDoorSlotState,
  GhostState,
  LockSlotState,
  ReturnSlotState,
  SlotStatus,
  SpiritCandleState,
  State,
} from './state-types';

/** Read-only projections of State for the interface (Req 31). All JSON-safe. */
export interface LockSlotView {
  readonly slotId: string;
  readonly stationType: LockType;
  readonly currentQuestionType: LockType;
  readonly status: SlotStatus;
  readonly candleLit: boolean;
  readonly appliedHint: AppliedHintState | null;
  readonly evidencePanelOpen: boolean;
}

export interface ReturnSlotView {
  readonly slotId: string;
  readonly conceptId: string;
  readonly returnNumber: 1 | 2;
  readonly currentQuestionType: LockType;
  readonly label: 'review' | null;
  readonly status: SlotStatus;
  readonly candleLit: boolean;
  readonly appliedHint: AppliedHintState | null;
  readonly evidencePanelOpen: boolean;
}

export interface FinalDoorSlotView {
  readonly slotId: string;
  readonly origin: 'reserved' | 'return';
  readonly currentQuestionType: LockType;
  readonly label: 'review' | null;
  readonly status: SlotStatus;
  readonly candleLit: boolean;
  readonly appliedHint: AppliedHintState | null;
  readonly evidencePanelOpen: boolean;
}

export interface GhostView {
  readonly conceptId: string;
  readonly returnNumber: 1 | 2;
  readonly due: boolean;
}

export interface RoomView {
  readonly roomId: string;
  readonly cleared: boolean;
  readonly lockSlots: readonly LockSlotView[];
  readonly returnSlots: readonly ReturnSlotView[];
  readonly spiritCandles: readonly SpiritCandleState[];
}

export interface FinalDoorView {
  readonly available: boolean;
  readonly slots: readonly FinalDoorSlotView[];
  readonly spiritCandles: readonly SpiritCandleState[];
}

function lockView(s: LockSlotState): LockSlotView {
  return {
    slotId: s.slotId,
    stationType: s.stationType,
    currentQuestionType: s.currentQuestionType,
    status: s.status,
    candleLit: s.candleLit,
    appliedHint: s.appliedHint,
    evidencePanelOpen: s.evidencePanelOpen,
  };
}

function returnView(s: ReturnSlotState): ReturnSlotView {
  return {
    slotId: s.slotId,
    conceptId: s.conceptId,
    returnNumber: s.returnNumber,
    currentQuestionType: s.currentQuestionType,
    label: s.label,
    status: s.status,
    candleLit: s.candleLit,
    appliedHint: s.appliedHint,
    evidencePanelOpen: s.evidencePanelOpen,
  };
}

function finalDoorSlotView(s: FinalDoorSlotState): FinalDoorSlotView {
  return {
    slotId: s.slotId,
    origin: s.origin,
    currentQuestionType: s.currentQuestionType,
    label: s.label,
    status: s.status,
    candleLit: s.candleLit,
    appliedHint: s.appliedHint,
    evidencePanelOpen: s.evidencePanelOpen,
  };
}

function ghostView(g: GhostState): GhostView {
  return { conceptId: g.conceptId, returnNumber: g.returnNumber, due: g.due };
}

/** Published rooms only (Req 31.1). */
export function selectRooms(state: State): readonly RoomView[] {
  return state.rooms
    .filter((room) => room.published)
    .map((room) => ({
      roomId: room.roomId,
      cleared: room.cleared,
      lockSlots: room.lockSlots.map(lockView),
      returnSlots: room.dueReturnSlots.map(returnView),
      spiritCandles: room.spiritCandles,
    }));
}

export function selectRoom(state: State, roomId: string): RoomView | null {
  return selectRooms(state).find((room) => room.roomId === roomId) ?? null;
}

export function selectGhosts(state: State): readonly GhostView[] {
  return state.ghosts.map(ghostView);
}

export function selectSpiritCandles(state: State, roomId: string): readonly SpiritCandleState[] {
  return state.rooms.find((room) => room.roomId === roomId)?.spiritCandles ?? [];
}

export function selectIsCleared(state: State, roomId: string): boolean {
  return state.rooms.find((room) => room.roomId === roomId)?.cleared ?? false;
}

/**
 * "Waiting for next room" (Req 8.6): the current room is Cleared, the next room is within
 * the final count (or the count is unknown) and the next room is not published.
 */
export function selectWaitingForNextRoom(state: State): boolean {
  if (state.status !== 'in progress' || state.currentRoomId === null) return false;
  const currentIndex = state.rooms.findIndex((room) => room.roomId === state.currentRoomId);
  const current = state.rooms[currentIndex];
  if (current === undefined || !current.cleared) return false;
  const next = state.rooms[currentIndex + 1];
  if (next === undefined || next.published) return false;
  return state.finalRoomCount === null || currentIndex + 2 <= state.finalRoomCount;
}

export function selectFinalDoor(state: State): FinalDoorView {
  return {
    available: state.finalDoor.available,
    slots: state.finalDoor.slots.map(finalDoorSlotView),
    spiritCandles: state.finalDoor.spiritCandles,
  };
}
