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
  BANNED_COPY_PHRASES,
  renderError,
  errorMessage,
} from './copy';
export type { ChunkInput, PdfPageInput } from './chunker';
export { chunkDocument } from './chunker';
export { citationLabel } from './citation-labeller';