import { parseNotesRecord } from '@escape-the-crypt/core';
import type { NotesRecord, Result } from '@escape-the-crypt/core';
import type { NotesStore, StorageUnavailable } from './notes-store';

import { NOTES_STORE_NAME, openDb } from '../../state/storage/db';

// Kept here so existing imports of these names keep working.
export { DB_NAME, NOTES_STORE_NAME } from '../../state/storage/db';

const UNAVAILABLE: Result<never, StorageUnavailable> = {
  ok: false,
  error: { kind: 'storage-unavailable' },
};

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  const opened = await openDb(factory);
  return opened.ok ? opened.value : null;
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