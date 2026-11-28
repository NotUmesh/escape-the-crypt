import type { ErrorCopy } from './copy';

/**
 * Why an exported copy could not be imported. Every kind says that nothing was changed: an import
 * writes everything or nothing.
 */
export const IMPORT_ERROR_KINDS = [
  'too-large',
  'not-json',
  'not-an-export',
  'unsupported-version',
  'crypt-invalid',
  'events-invalid',
  'no-notes',
  'notes-invalid',
  'notes-conflict',
  'duplicate',
  'conflict',
  'storage-unavailable',
  'quota-exceeded',
  'write-failed',
] as const;
export type ImportErrorKind = (typeof IMPORT_ERROR_KINDS)[number];

const CHOOSE_AGAIN = 'Choose the file that "Export a copy" downloaded. Nothing was changed.';

/** The "Import a crypt" action on the desk, and what it says when a file is refused. */
export const IMPORT_COPY = {
  button: 'Import a crypt',
  working: 'Reading your copy.',
  hint: 'Choose a copy you exported from Escape the Crypt. The file is read on this device and goes nowhere else.',
  done: {
    active: 'Imported. The crypt is on your shelf, and you can continue it there.',
    escaped: 'Imported. The crypt is on your shelf.',
  },
  errors: {
    'too-large': {
      what: 'That file is too large to be a copy of a crypt.',
      next: CHOOSE_AGAIN,
    },
    'not-json': {
      what: "We couldn't read that file as a copy of a crypt.",
      next: CHOOSE_AGAIN,
    },
    'not-an-export': {
      what: 'That file is not a copy from Escape the Crypt, or it was changed after it was saved.',
      next: CHOOSE_AGAIN,
    },
    'unsupported-version': {
      what: 'That copy was made by a newer version of Escape the Crypt.',
      next: 'Open it in the version that made it, or export it again from there. Nothing was changed.',
    },
    'crypt-invalid': {
      what: 'The crypt inside that copy did not pass the same checks a new crypt does.',
      next: 'Export a fresh copy and try again. Nothing was changed.',
    },
    'events-invalid': {
      what: "The saved moves in that copy don't fit its crypt.",
      next: 'Export a fresh copy and try again. Nothing was changed.',
    },
    'no-notes': {
      what: 'That copy was exported without your notes, so its crypt cannot be opened here.',
      next: 'Export it again from a device that still has the notes. Nothing was changed.',
    },
    'notes-invalid': {
      what: "The notes in that copy don't match the questions made from them.",
      next: 'Export a fresh copy and try again. Nothing was changed.',
    },
    'notes-conflict': {
      what: 'This device already holds different notes under the same fingerprint.',
      next: 'Nothing was changed. Your own notes were left as they are.',
    },
    duplicate: {
      what: 'That crypt is already on this device.',
      next: 'Nothing was changed. You will find it on your shelf.',
    },
    conflict: {
      what: 'A different crypt with the same identity is already on this device.',
      next: 'Nothing was changed. Your saved crypt was left as it is.',
    },
    'storage-unavailable': {
      what: "We couldn't save to this device.",
      next: 'Check that your browser allows saving, then try again. Nothing was changed.',
    },
    'quota-exceeded': {
      what: 'There is no room left on this device.',
      next: 'Free some space and try again. Nothing was changed.',
    },
    'write-failed': {
      what: "We couldn't save that crypt.",
      next: 'Try again. Nothing was changed.',
    },
  } satisfies Readonly<Record<ImportErrorKind, ErrorCopy>>,
} as const;
