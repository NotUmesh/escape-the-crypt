export type {
  SourceType,
  SourceLocation,
  Chunk,
  PageFlag,
  ResolvedLocation,
  QuoteError,
  Result,
  LimitError,
  IngestError,
  NotesRecord,
  Event,
} from './types';
export {
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_PAGES,
  MAX_EXTRACTED_WORDS,
  MAX_EXTRACTION_MS,
  checkFileSize,
  capPageSelection,
  countWords,
  checkWordCount,
  checkElapsed,
} from './limits';
export type { TextItemData } from './pdf-text-assembly';
export {
  PARAGRAPH_GAP_FACTOR,
  LINE_Y_TOLERANCE_FACTOR,
  assemblePageText,
} from './pdf-text-assembly';
export {
  LOW_TEXT_MIN_WORDS,
  GARBLE_MAX_RATIO,
  SHORT_LINE_MIN_LINES,
  SHORT_LINE_MEDIAN_CHARS,
  classifyPage,
} from './page-checker';
export {
  PASTE_UNIT_SEPARATOR,
  PDF_UNIT_SEPARATOR,
  documentDigest,
} from './digest';
export { MAX_CHUNK_CHARS, HEADING_MAX_CHARS } from './chunker-split';
export { MIN_CHUNK_CHARS } from './chunker-merge';
export type { NormalisedText } from './normalise';
export { normaliseWithMap } from './normalise';
export { MIN_QUOTE_WORDS, MIN_QUOTE_CHARS, resolveQuote } from './quote-resolver';
export type { ErrorCopy, PageFlagCopy } from './copy';
export {
  ERROR_COPY,
  PRIVACY_NOTICE,
  PRIVACY_NOTICE_TEXT,
  PAGE_FLAG_COPY,
  CITATION_COPY,
  ANNOUNCEMENT_COPY,
  INGEST_UI_COPY,
  BANNED_COPY_PHRASES,
  renderError,
  errorMessage,
} from './copy';
export type { ChunkInput, PdfPageInput } from './chunker';
export { chunkDocument } from './chunker';
export { citationLabel } from './citation-labeller';
export type {
  HumanHeartQuestionsFile,
  SampleQuestionError,
  SampleCryptError,
  SampleCryptResult,
} from './sample-crypt/human-heart';
export { buildHumanHeartSampleCrypt, isHumanReviewed, SAMPLE_CONCEPT_TITLES } from './sample-crypt/human-heart';
export type { CryptManifest, RunSettings } from './runtime/manifest-types';
export type { State, LockSlotState, ReturnSlotState, FinalDoorSlotState, SlotStatus } from './runtime/state-types';
export type { Outcome_Notice } from './runtime/notices';
export type { Typed_Rejection, LockType } from './types';
export {
  LOCK_OBJECT_NAMES,
  ROOM_DISPLAY_NAMES,
  roomDisplayName,
  SLOT_STATUS_WORDS,
  FINAL_DOOR_BUTTON_TEXT,
  FINAL_DOOR_STATUS_LABELS,
  ROOM_PLAY_LABELS,
  ROOM_ANNOUNCEMENT_COPY,
  SAMPLE_CRYPT_LABEL,
  SAMPLE_CRYPT_LINE,
  ENTER_CRYPT_LABEL,
  ROOM_START_ERROR_COPY,
  ESCAPE_COPY,
} from './copy-room-play';
export type { RoomStartErrorKind } from './copy-room-play';
export { initial } from './runtime/initial';
export { apply } from './runtime/apply';
export type { CryptContent } from './mapper/crypt-content';
export { NOTES_SCHEMA_VERSION, makeNotesRecord, parseNotesRecord } from './notes-record';
export { z } from './zod';
