export type SourceType = 'pdf' | 'paste';

export type SourceLocation =
  | { sourceType: 'pdf'; pdfPageIndex: number; printedPageLabel: string | null }
  | { sourceType: 'paste'; paragraphNumber: number };

export interface Chunk {
  readonly id: string; // chk_<digest12>_<position>
  readonly documentDigest: string; // sha-256 hex of confirmed text
  readonly position: number; // 0-based position in the document
  readonly text: string;
  readonly location: SourceLocation; // exactly one location
  readonly edited: boolean;
}

export type PageFlag = 'ok' | 'low-text' | 'suspicious';

export interface ResolvedLocation {
  readonly chunkId: string;
  readonly start: number; // offset in original, unnormalised chunk text
  readonly end: number; // exclusive
}

export type QuoteError =
  | { kind: 'not-found' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'unknown-chunk' }
  | { kind: 'too-short' };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type LimitError =
  | { kind: 'file-size'; limitBytes: number }
  | { kind: 'page-count'; limit: number }
  | { kind: 'word-count'; limit: number }
  | { kind: 'time'; limitMs: number };

export type IngestError =
  | LimitError
  | { kind: 'encrypted' }
  | { kind: 'unreadable' }
  | { kind: 'empty' }
  | { kind: 'storage-unavailable' };

/** What the app keeps on the device for one confirmed document. No file bytes, no file name. */
export interface NotesRecord {
  readonly schemaVersion: number;
  readonly documentDigest: string;
  readonly chunks: readonly Chunk[];
}

// ---------------------------------------------------------------------------
// Room runtime shared types (spec: room-runtime). Plain JSON shapes only.
// ---------------------------------------------------------------------------

/** The six lock types. These are the only valid IDs (Req 27.1). */
export const LOCK_TYPES = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
] as const;

export type LockType = (typeof LOCK_TYPES)[number];

export type JudgeResult = 'correct' | 'wrong' | 'invalid';

/** An ordered [leftId, rightId] tuple. */
export type ThreadPair = readonly [string, string];

/** The hint effect belongs to the question, not to the slot that shows it. */
export type HintEffectSpec =
  | { readonly kind: 'remove-option'; readonly optionId: string }
  | { readonly kind: 'lock-first-bone'; readonly boneId: string }
  | { readonly kind: 'tie-thread'; readonly pair: ThreadPair }
  | { readonly kind: 'reveal-digit'; readonly position: number };

export type Event =
  | { readonly kind: 'RunStarted'; readonly manifestId: string }
  | { readonly kind: 'RoomPublished'; readonly roomId: string }
  | { readonly kind: 'CryptFinalised'; readonly finalRoomCount: number }
  | { readonly kind: 'CryptShortened'; readonly finalRoomCount: number }
  | { readonly kind: 'RoomEntered'; readonly roomId: string }
  | { readonly kind: 'LockOpened'; readonly slotId: string }
  | { readonly kind: 'HintUsed'; readonly slotId: string }
  /** `submission` is JSON data only, narrowed by the slot's Current_Question_Type. */
  | { readonly kind: 'AnswerSubmitted'; readonly slotId: string; readonly submission: unknown }
  | { readonly kind: 'Skipped'; readonly slotId: string }
  | { readonly kind: 'Challenged'; readonly slotId: string }
  | { readonly kind: 'EvidenceContinued'; readonly slotId: string }
  | { readonly kind: 'FinalDoorEntered' }
  | { readonly kind: 'RunLeft' }
  | { readonly kind: 'RunResumed' };

export type EventKind = Event['kind'];

/** Every Event kind, in declaration order. */
export const EVENT_KINDS = [
  'RunStarted',
  'RoomPublished',
  'CryptFinalised',
  'CryptShortened',
  'RoomEntered',
  'LockOpened',
  'HintUsed',
  'AnswerSubmitted',
  'Skipped',
  'Challenged',
  'EvidenceContinued',
  'FinalDoorEntered',
  'RunLeft',
  'RunResumed',
] as const satisfies readonly EventKind[];

/** Closed union of rejection kinds (Req 3.2). */
export type RuntimeErrorKind =
  | 'manifest-mismatch'
  | 'run-already-started'
  | 'run-not-started'
  | 'invalid-manifest'
  | 'unknown-reference'
  | 'run-left'
  | 'run-finished'
  | 'lock-already-settled'
  | 'malformed-event'
  | 'room-not-published'
  | 'room-not-cleared'
  | 'room-out-of-order'
  | 'cannot-shorten-published'
  | 'lock-not-in-room'
  | 'invalid-submission'
  | 'no-evidence-open'
  | 'no-hints-left'
  | 'hint-already-used'
  | 'final-door-unavailable'
  | 'run-not-left'
  | 'cannot-leave';

/** A typed rejection. Extra fields are diagnostics only and never carry user content. */
export type Typed_Rejection = {
  readonly kind: RuntimeErrorKind;
  readonly [key: string]: unknown;
};
