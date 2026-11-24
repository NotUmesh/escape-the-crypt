import type { HintEffectSpec, LockType } from '../types';

/** One question as the runtime consumes it. `payload` is plain JSON, narrowed by `lockType`. */
export interface QuestionSpec {
  /** Unique within the manifest (Req 28.8, 28.9). */
  readonly questionId: string;
  readonly lockType: LockType;
  readonly payload: unknown;
  readonly evidenceRefs: readonly string[];
  /** Each primary, Alternate and reserved final-door question carries its own effect, or null. */
  readonly hintEffect: HintEffectSpec | null;
}

export interface LockSlotSpec {
  readonly slotId: string;
  readonly stationType: LockType;
  readonly conceptId: string;
  /** `lockType` equals `stationType`. */
  readonly primaryQuestion: QuestionSpec;
  /** `lockType` differs from the primary's. */
  readonly alternateQuestion: QuestionSpec | null;
}

export interface RoomSpec {
  readonly roomId: string;
  /** At most one slot per LockType (Req 28). */
  readonly lockSlots: readonly LockSlotSpec[];
}

/** A fully specified reserved final-door slot. Lock types may repeat across entries. */
export interface FinalDoorSlotSpec {
  readonly slotId: string;
  readonly conceptId: string;
  readonly question: QuestionSpec;
}

export interface CryptManifest {
  readonly manifestId: string;
  readonly rooms: readonly RoomSpec[];
  /** 2 to 4 entries (Req 20.1). */
  readonly finalDoor: { readonly slots: readonly FinalDoorSlotSpec[] };
}

export interface RunSettings {
  readonly length: 'short' | 'standard' | 'long';
  readonly difficulty: 'apprentice' | 'gravedigger' | 'lich';
  readonly hintAllowance: number;
}
