import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

export const DB_NAME = 'escape-the-crypt';
export const DB_VERSION = 2;
export const STORES = {
  notes: 'notes',
  crypts: 'crypts',
  runs: 'runs',
  events: 'events',
} as const;
export const NOTES_STORE_NAME = STORES.notes;
export const RUNS_BY_STATUS_INDEX = 'by-status';

/**
 * Additive upgrade. Each step only creates stores that are missing. No step opens a cursor on, or
 * writes to, `notes`, so existing notes records are left as they are (1.3).
 */
export function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1 && !db.objectStoreNames.contains(STORES.notes)) {
    db.createObjectStore(STORES.notes, { keyPath: 'documentDigest' });
  }
  if (oldVersion < 2) {
    if (!db.objectStoreNames.contains(STORES.crypts)) {
      db.createObjectStore(STORES.crypts, { keyPath: 'manifestId' });
    }
    if (!db.objectStoreNames.contains(STORES.runs)) {
      const runs = db.createObjectStore(STORES.runs, { keyPath: 'runId' });
      runs.createIndex(RUNS_BY_STATUS_INDEX, 'status');
    }
    if (!db.objectStoreNames.contains(STORES.events)) {
      db.createObjectStore(STORES.events, { keyPath: ['runId', 'seq'] });
    }
  }
}

/**
 * Opens the database at version 2 and runs the upgrade. Never throws. A database at a higher
 * version is `unsupported-version`; anything else that goes wrong is `storage-unavailable`.
 */
export function openDb(factory: IDBFactory | undefined): Promise<StorageResult<IDBDatabase>> {
  if (factory === undefined) return Promise.resolve(storageError('storage-unavailable'));
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(storageError('storage-unavailable'));
      return;
    }
    request.onupgradeneeded = (event) => {
      try {
        upgrade(request.result, event.oldVersion);
      } catch {
        // Aborting the upgrade transaction fires `onerror` on the request.
        try {
          request.transaction?.abort();
        } catch {
          // Already finished.
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let another tab upgrade later instead of being blocked by this connection.
      db.onversionchange = () => db.close();
      resolve({ ok: true, value: db });
    };
    request.onerror = () => {
      const name = request.error?.name;
      resolve(storageError(name === 'VersionError' ? 'unsupported-version' : 'storage-unavailable'));
    };
    request.onblocked = () => resolve(storageError('storage-unavailable'));
  });
}
