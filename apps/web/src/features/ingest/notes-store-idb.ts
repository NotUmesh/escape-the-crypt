import { parseNotesRecord } from '@escape-the-crypt/core';
import type { NotesRecord, Result } from '@escape-the-crypt/core';
import type { NotesStore, StorageUnavailable } from './notes-store';

export const DB_NAME = 'escape-the-crypt';
export const DB_VERSION = 1;
export const NOTES_STORE_NAME = 'notes';

const UNAVAILABLE: Result<never, StorageUnavailable> = {
  ok: false,
  error: { kind: 'storage-unavailable' },
};

function openDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Version 1 creates the store. A later version only adds stores and leaves this one alone.
      if (!db.objectStoreNames.contains(NOTES_STORE_NAME)) {
        db.createObjectStore(NOTES_STORE_NAME, { keyPath: 'documentDigest' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/**
 * IndexedDB adapter. Errors are turned into the kind only and never logged:
 * an error message could contain notes text (18.6).
 */
export function createIdbStore(factory: IDBFactory | undefined): NotesStore {
  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore, done: (value: T) => void) => void,
  ): Promise<Result<T, StorageUnavailable>> => {
    if (factory === undefined) return UNAVAILABLE;
    const db = await openDatabase(factory);
    if (db === null) return UNAVAILABLE;
    return new Promise((resolve) => {
      let value: T | undefined;
      let hasValue = false;
      try {
        const tx = db.transaction(NOTES_STORE_NAME, mode);
        tx.oncomplete = () => {
          db.close();
          resolve(hasValue ? { ok: true, value: value as T } : UNAVAILABLE);
        };
        tx.onerror = () => {
          db.close();
          resolve(UNAVAILABLE);
        };
        tx.onabort = () => {
          db.close();
          resolve(UNAVAILABLE);
        };
        run(tx.objectStore(NOTES_STORE_NAME), (v) => {
          value = v;
          hasValue = true;
        });
      } catch {
        db.close();
        resolve(UNAVAILABLE);
      }
    });
  };

  return {
    // `put` replaces a record with the same digest, so no second record exists (18.4).
    save: (record: NotesRecord) =>
      withStore<true>('readwrite', (store, done) => {
        store.put(record);
        done(true);
      }),
    async load(documentDigest) {
      const read = await withStore<unknown>('readonly', (store, done) => {
        const request = store.get(documentDigest);
        request.onsuccess = () => done(request.result);
      });
      if (!read.ok) return read;
      if (read.value === undefined) return { ok: true, value: null };
      const parsed = parseNotesRecord(read.value);
      // A record this version cannot read is left in place and reported as unavailable.
      return parsed.ok ? { ok: true, value: parsed.value } : UNAVAILABLE;
    },
  };
}