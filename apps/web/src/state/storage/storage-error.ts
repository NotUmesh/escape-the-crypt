import type { Result } from '@escape-the-crypt/core';

export type StorageErrorKind =
  | 'storage-unavailable'
  | 'unsupported-version'
  | 'crypt-invalid'
  | 'manifest-conflict'
  | 'record-unreadable'
  | 'run-not-found'
  | 'event-log-gap'
  | 'event-log-rejected'
  | 'notes-unavailable'
  | 'write-failed'
  | 'quota-exceeded';

/** The kind only. No message, no underlying error text and no stored content (7.7). */
export interface StorageError {
  readonly kind: StorageErrorKind;
}

export type StorageResult<T> = Result<T, StorageError>;

export function storageError(kind: StorageErrorKind): { ok: false; error: StorageError } {
  return { ok: false, error: { kind } };
}
