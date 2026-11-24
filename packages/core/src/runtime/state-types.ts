import type { HintEffectSpec, JudgeResult, LockType } from '../types';
import type { CryptManifest, RunSettings } from './manifest-types';

export type SlotStatus = 'open' | 'solved' | 'settled' | 'challenged';

/**
 * A hint used on one question, recorded with the question it applies to.
 * It counts as applied only while `questionId` equals the slot's currentQuestionId.
 */
export interface AppliedHintState {
  readonly questionId: string;
  readonly effect: HintEffectSpec | null;
}

export interface LockSlotState {
  readonly slotId: string;
  readonly stationType: LockType;
  readonly currentQuestionId: string;
  readonly currentQuestionType: LockType;
  readonly status: SlotStatus;
  /** True only while status is 'solved'. */
  readonly candleLit: boolean;
  readonly appliedHint: AppliedHintState | null;
  readonly evidencePanelOpen: boolean;
  readonly judgedResult: JudgeResult | null;
}

export interface ReturnSlotState {
  readonly slotId: string;
  readonly conceptId: string;
  readonly returnNumber: 1 | 2;
  readonly currentQuestionId: string;
  readonly currentQuestionType: LockType;
  /** 'review' iff the question was already shown for this concept. */
  readonly label: 'review' | null;
  readonly status: SlotStatus;
  readonly candleLit: boolean;
  readonly appliedHint: AppliedHintState | null;
  readonly evidencePanelOpen: boolean;
}

export interface FinalDoorSlotState {
  readonly slotId: string;
  readonly origin: 'reserved' | 'return';
  readonly currentQuestionId: string;
  readonly currentQuestionType: LockType;
  /** Always null for origin 'reserved'. */
  readonly label: 'review' | null;
  readonly status: SlotStatus;
  readonly candleLit: boolean;
  readonly appliedHint: AppliedHintState | null;
  readonly evidencePanelOpen: boolean;
}

export interface GhostState {
  readonly conceptId: string;
  readonly returnNumber: 1 | 2;
  readonly judgedAnswerCountAtSpawn: number;
  readonly due: boolean;
}

export interface SpiritCandleState {
  readonly conceptId: string;
  readonly returnSlotId: string;
}

export interface RoomState {
  readonly roomId: string;
  readonly published: boolean;
  readonly cleared: boolean;
  readonly lockSlots: readonly LockSlotState[];
  readonly dueReturnSlots: readonly ReturnSlotState[];
  readonly spiritCandles: readonly SpiritCandleState[];
}

export interface FinalDoorState {
  readonly available: boolean;
  readonly slots: readonly FinalDoorSlotState[];
  readonly spiritCandles: readonly SpiritCandleState[];
}

export type ConceptOutcome =
  | 'challenged'
  | 'review-due'
  | 'retried'
  | 'assisted'
  | 'first-try-correct';

/** Per-concept facts the outcome derivation (Req 22) reads. */
export interface ConceptRecord {
  readonly conceptId: string;
  readonly shownQuestionIds: readonly string[];
  readonly firstQuestionResult: JudgeResult | 'challenged' | null;
  readonly hintUsedOnCorrectQuestion: boolean;
  readonly alternateUsed: boolean;
  readonly alternateChallenged: boolean;
  readonly alternateResult: JudgeResult | 'challenged' | null;
  readonly return1Result: JudgeResult | 'challenged' | null;
  readonly return2Result: JudgeResult | 'challenged' | null;
  readonly wasSkippedWithNoAlternate: boolean;
  readonly isLingeringSpirit: boolean;
  readonly reviewDueFlag: boolean;
}

export type RunStatus = 'not started' | 'in progress' | 'left' | 'escaped';

export interface State {
  readonly manifestId: string;
  /**
   * The manifest the run plays. `apply(state, event)` takes no manifest argument,
   * so State carries it (plain JSON, never changed).
   */
  readonly manifest: CryptManifest;
  readonly status: RunStatus;
  /** Settings given to `initial`; `RunStarted` starts the run with them. */
  readonly settings: RunSettings;
  readonly remainingHints: number;
  readonly candleCount: number;
  readonly judgedAnswerCount: number;
  readonly rooms: readonly RoomState[];
  readonly currentRoomId: string | null;
  readonly finalRoomCount: number | null;
  readonly finalDoor: FinalDoorState;
  readonly ghosts: readonly GhostState[];
  readonly concepts: readonly ConceptRecord[];
  readonly focusedSlotId: string | null;
}
