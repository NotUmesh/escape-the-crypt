import type { NotesRecord, Result } from '@escape-the-crypt/core';

export type StorageUnavailable = { readonly kind: 'storage-unavailable' };

/**
 * Where confirmed notes live on this device. The only value a store accepts is a
 * `NotesRecord`: no file bytes, no file name (18.5).
 */
export interface NotesStore {
  save(record: NotesRecord): Promise<Result<true, StorageUnavailable>>;
  load(documentDigest: string): Promise<Result<NotesRecord | null, StorageUnavailable>>;
}

/**
 * Saves to `primary`. If that reports `storage-unavailable`, the same record is
 * kept in `fallback` for the session and the failure is still reported, so the
 * flow can tell the learner while they keep going (18.8). `load` tries the
 * primary store, then the fallback.
 */
export function createSessionStore(primary: NotesStore, fallback: NotesStore): NotesStore {
  return {
    async save(record) {
      const saved = await primary.save(record);
      if (saved.ok) return saved;
      await fallback.save(record);
      return saved;
    },
    async load(documentDigest) {
      const found = await primary.load(documentDigest);
      if (found.ok && found.value !== null) return found;
      const kept = await fallback.load(documentDigest);
      return kept.ok && kept.value !== null ? kept : found;
    },
  };
}