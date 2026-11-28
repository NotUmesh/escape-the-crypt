import type { ImportErrorKind } from '@escape-the-crypt/core';
import type { ImportError, ImportResult } from './import-run';

export type { ImportError, ImportResult };

/** What a successful import reports. IDs and flags only; nothing from the file's text. */
export interface ImportedCrypt {
  readonly manifestId: string;
  readonly runId: string;
  readonly status: 'active' | 'escaped';
  readonly source: 'sample' | 'generated';
  /** True when the file's notes were kept on this device. */
  readonly withNotes: boolean;
}

export function importFailure(kind: ImportErrorKind): { ok: false; error: ImportError } {
  return { ok: false, error: { kind } };
}

export function importSuccess(value: ImportedCrypt): { ok: true; value: ImportedCrypt } {
  return { ok: true, value };
}
