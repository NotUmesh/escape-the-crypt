import type { NotesRecord } from '@escape-the-crypt/core';
import type { NotesStore } from './notes-store';

/** In-memory store: the session fallback and the test double. Lost when the tab closes. */
export function createMemoryStore(): NotesStore {
  const records = new Map<string, NotesRecord>();
  return {
    save(record) {
      records.set(record.documentDigest, record);
      return Promise.resolve({ ok: true, value: true });
    },
    load(documentDigest) {
      return Promise.resolve({ ok: true, value: records.get(documentDigest) ?? null });
    },
  };
}