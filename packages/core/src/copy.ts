import {
  MAX_EXTRACTED_WORDS,
  MAX_EXTRACTION_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_PAGES,
} from './limits';
import type { IngestError, PageFlag } from './types';

/** A problem message always has both parts, so no message can omit the next step. */
export interface ErrorCopy {
  readonly what: string;
  readonly next: string;
}

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
const MAX_SECONDS = MAX_EXTRACTION_MS / 1000;
const WORD_LIMIT_TEXT = MAX_EXTRACTED_WORDS.toLocaleString('en-US');

/** One entry per IngestError kind. Values are built from the limit constants. */
export const ERROR_COPY: Readonly<Record<IngestError['kind'], ErrorCopy>> = {
  'file-size': {
    what: `This file is larger than ${MAX_FILE_SIZE_MB} MB, so we can't open it.`,
    next: 'Try a smaller PDF, or paste the text instead.',
  },
  'page-count': {
    what: `You can include up to ${MAX_SELECTED_PAGES} pages. We kept the first ${MAX_SELECTED_PAGES}.`,
    next: 'Remove one to choose a different page.',
  },
  'word-count': {
    what: `Your notes are over ${WORD_LIMIT_TEXT} words.`,
    next: 'Remove some pages or paste a shorter part.',
  },
  time: {
    what: `Reading this file took longer than ${MAX_SECONDS} seconds, so we stopped.`,
    next: 'Try fewer pages or paste the text instead.',
  },
  encrypted: {
    what: "This PDF is protected with a password, so we can't read it.",
    next: 'Save an unprotected copy or paste the text instead.',
  },
  unreadable: {
    what: "We couldn't read this file as a PDF.",
    next: 'Try another PDF, or paste the text instead.',
  },
  empty: {
    what: "There's no text in your notes yet.",
    next: 'Paste some text or choose at least one page with text.',
  },
  'storage-unavailable': {
    what: "Your notes couldn't be saved on this device.",
    next: 'You can keep going this session. Copy your notes somewhere safe before you close this tab.',
  },
};

/** Joins the two parts. The only way a problem message is rendered. */
export function renderError(copy: ErrorCopy): string {
  return `${copy.what} ${copy.next}`;
}

export function errorMessage(error: IngestError): string {
  return renderError(ERROR_COPY[error.kind]);
}

export const PRIVACY_NOTICE: Readonly<{ stays: string; sent: string }> = {
  stays: 'Your file stays on this device while we read it.',
  sent: 'Only the notes text you confirm will be sent later to build questions.',
};

export const PRIVACY_NOTICE_TEXT = `${PRIVACY_NOTICE.stays} ${PRIVACY_NOTICE.sent}`;

export interface PageFlagCopy {
  readonly label: string;
  readonly detail: string;
}

/** The label is shown beside an icon. The detail explains the flag and the next step. */
export const PAGE_FLAG_COPY: Readonly<Record<PageFlag, PageFlagCopy>> = {
  ok: {
    label: 'Looks good',
    detail: 'We could read the text on this page.',
  },
  'low-text': {
    label: 'Low text',
    detail:
      "This page looks like a scan, so we can't read its text. Remove it or paste the text instead.",
  },
  suspicious: {
    label: 'Check this page',
    detail:
      'The text here may be jumbled, like a table or columns. Read it over, fix it, or remove the page.',
  },
};

/** Citation label templates. The Citation Labeller fills these in. */
export const CITATION_COPY = {
  pdfPage: (page: number, printedLabel: string | null): string =>
    `PDF page ${pageReference(page, printedLabel)}`,
  pasteParagraph: (paragraphNumber: number): string =>
    `Paragraph ${paragraphNumber} of your notes`,
  editedPdf: (page: number, printedLabel: string | null): string =>
    `Your edited notes, originally extracted from PDF page ${pageReference(page, printedLabel)}`,
} as const;

/** `5` when there is no distinct printed label, else `5 (printed page iv)`. */
function pageReference(page: number, printedLabel: string | null): string {
  if (printedLabel === null || printedLabel === String(page)) return String(page);
  return `${page} (printed page ${printedLabel})`;
}

/** Words ingest copy and labels must never contain. Used by tests. */
export const BANNED_COPY_PHRASES: readonly string[] = [
  'verified',
  'guaranteed',
  '100% accurate',
  'hallucination-free',
  'mastered',
  'exam-ready',
  'the source document',
];
