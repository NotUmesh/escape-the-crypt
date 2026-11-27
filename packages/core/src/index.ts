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
  AUTOPSY_LABELS,
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
export type { State, LockSlotState, ReturnSlotState, FinalDoorSlotState, SlotStatus, ConceptOutcome, ConceptRecord } from './runtime/state-types';
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
  REVIEW_PASSED_LABEL,
  ROOM_ANNOUNCEMENT_COPY,
  SAMPLE_CRYPT_LABEL,
  SAMPLE_CRYPT_LINE,
  ENTER_CRYPT_LABEL,
  ROOM_START_ERROR_COPY,
  ESCAPE_COPY,
  GENERATION_COPY,
} from './copy-room-play';
export type { RoomStartErrorKind, GenerationFailureKind } from './copy-room-play';
export { initial } from './runtime/initial';
export { apply } from './runtime/apply';
export { isEvent } from './runtime/event-guard';
export { selectFinalDoor, selectAutopsy } from './runtime/selectors';
export type { AutopsyCounts } from './runtime/selectors';
export type { CryptContent } from './mapper/crypt-content';
export { parseCryptBundle } from './mapper/crypt-bundle-parse';
export type { CryptBundle, CryptBundleError } from './mapper/crypt-bundle-parse';
export type { AutopsyEntry } from './runtime/autopsy-selector';
export { NOTES_SCHEMA_VERSION, makeNotesRecord, parseNotesRecord } from './notes-record';
export { z } from './zod';
export { runRoomPipeline } from './pipeline/orchestrator';
export type {
  AbortSignalLike,
  PipelineOptions,
  PipelineResult,
  PipelineJobError,
  PipelineJobFailure,
  UnplacedAccepted,
} from './pipeline/orchestrator';
export type { PipelineStageError } from './pipeline/stage-error';
export type {
  PipelineRunMetadata,
  PipelineRunCounts,
  TimedStage,
} from './pipeline/run-metadata';
export type { RecordedCall } from './pipeline/recording-provider';
export type {
  CandidateOutcome,
  CandidateResult,
  ConceptGenerationOutcome,
  GenerationOutcome,
  Placement,
  RunOutcomes,
} from './pipeline/candidate-outcomes';
export { DEFAULT_ASSEMBLY_POLICY, LEGACY_ASSEMBLY_POLICY } from './pipeline/room-assembly';
export type { AssemblyPolicy } from './pipeline/room-assembly';
export { answerKey, duplicateAnswerScan, keyedSpec } from './checks/duplicate-answers';
export type { KeyedAnswer } from './checks/duplicate-answers';
export { CHECK_VERSION } from './checks/registry';
export { promptDigest } from './provider/prompt-digest';
export { toModelJsonSchema } from './provider/model-json-schema';
export type { ModelJsonSchema, ModelJsonSchemaError } from './provider/model-json-schema';
export type {
  Provider,
  ProviderRequest,
  ProviderResult,
  ProviderSuccess,
  ProviderFailure,
  ProviderStage,
  ProviderUsage,
  ProviderErrorKind,
} from './provider/types';
export type {
  BudgetLedger,
  BudgetReservation,
  BudgetResult,
  BudgetErrorKind,
} from './budget/types';
export { makeMockLedger, countingProvider } from './budget/mock-ledger';
export type { MockLedger, MockLedgerOptions, CountingProvider } from './budget/mock-ledger';
export { makeCassetteProvider, isCassetteMissing } from './cassette/cassette-provider';
export { parseCassetteFile } from './cassette/types';
export type {
  CassetteFile,
  CassetteEntry,
  CassetteOrigin,
  CassetteParseError,
} from './cassette/types';
export { assertRecordedOnly } from './cassette/recorded-only';
export type { SyntheticCassetteInEvaluationError } from './cassette/recorded-only';
export {
  JOB_STATUSES,
  JOB_FAILURE_KINDS,
  JobStatusNameSchema,
  JobFailureKindSchema,
  JobAckStatusSchema,
  UnplacedAcceptedSchema,
  JobBundleSchema,
  JobFailureSchema,
  JobStatusResponseSchema,
  JobAckResponseSchema,
  JobErrorResponseSchema,
} from './job-api/job-response-schema';
export type {
  JobStatusName,
  JobFailureKindName,
  JobBundle,
  JobFailureBody,
  JobStatusResponse,
  JobAckResponse,
  JobErrorResponse,
} from './job-api/job-response-schema';
