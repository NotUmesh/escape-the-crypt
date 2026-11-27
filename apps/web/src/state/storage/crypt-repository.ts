import { parseCryptBundle } from '@escape-the-crypt/core';
import { openDb, STORES } from './db';
import { parseCryptRecord } from './records';
import type { CryptRecord } from './records';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

export interface SaveCryptInput {
  /** `{ manifest, content }` as `parseCryptBundle` accepts it. */
  readonly bundle: unknown;
  readonly source: 'sample' | 'generated';
  /** Digest of the notes a generated crypt was made from. */
  readonly documentDigest?: string;
}

/** JSON with object keys sorted, so equal content serialises equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) sorted[key] = (v as Record<string, unknown>)[key];
      return sorted;
    }
    return v;
  });
}

function isQuota(error: DOMException | null): boolean {
  return error?.name === 'QuotaExceededError';
}

type SaveOutcome = StorageResult<{ manifestId: string }>;

function runSave(db: IDBDatabase, record: CryptRecord): Promise<SaveOutcome> {
  return new Promise((resolve) => {
    let outcome: SaveOutcome | null = null;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORES.crypts, 'readwrite');
    } catch {
      resolve(storageError('write-failed'));
      return;
    }
    const finish = (): void => resolve(outcome ?? storageError('write-failed'));
    tx.oncomplete = finish;
    tx.onabort = () => {
      if (outcome === null || outcome.ok) {
        resolve(storageError(isQuota(tx.error) ? 'quota-exceeded' : 'write-failed'));
      } else {
        resolve(outcome);
      }
    };
    tx.onerror = () => {
      // The abort handler resolves.
    };
    try {
      const store = tx.objectStore(STORES.crypts);
      const getReq = store.get(record.manifestId);
      getReq.onsuccess = () => {
        const existing: unknown = getReq.result;
        if (existing === undefined) {
          outcome = { ok: true, value: { manifestId: record.manifestId } };
          store.add(record);
          return;
        }
        outcome =
          canonicalJson(existing) === canonicalJson(record)
            ? { ok: true, value: { manifestId: record.manifestId } }
            : storageError('manifest-conflict');
      };
    } catch {
      outcome = storageError('write-failed');
      try {
        tx.abort();
      } catch {
        // Already finished.
      }
    }
  });
}

/**
 * Saves a crypt. Validates with `parseCryptBundle` first; a rejected crypt writes nothing. One
 * readwrite transaction then adds the record, accepts an identical re-save as a no-op, or
 * returns `manifest-conflict`. Never throws.
 */
export async function saveCrypt(
  factory: IDBFactory | undefined,
  input: SaveCryptInput,
): Promise<SaveOutcome> {
  try {
    const parsed = parseCryptBundle(input.bundle);
    if (!parsed.ok) return storageError('crypt-invalid');
    const { manifest, content } = parsed.value;
    const record: CryptRecord = {
      schemaVersion: 1,
      manifestId: manifest.manifestId,
      manifest,
      content,
      source: input.source,
      ...(input.documentDigest === undefined ? {} : { documentDigest: input.documentDigest }),
    };
    const opened = await openDb(factory);
    if (!opened.ok) return opened;
    try {
      return await runSave(opened.value, record);
    } finally {
      opened.value.close();
    }
  } catch {
    return storageError('write-failed');
  }
}

function runLoad(db: IDBDatabase, manifestId: string): Promise<StorageResult<CryptRecord>> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORES.crypts, 'readonly');
      const req = tx.objectStore(STORES.crypts).get(manifestId);
      req.onsuccess = () => {
        resolve(req.result === undefined ? storageError('record-unreadable') : parseCryptRecord(req.result));
      };
      req.onerror = () => resolve(storageError('storage-unavailable'));
      // An abort can arrive without a request error; resolve so the caller never waits forever.
      // A promise settles once, so this is a no-op after onsuccess or onerror.
      tx.onabort = () => resolve(storageError('storage-unavailable'));
    } catch {
      resolve(storageError('storage-unavailable'));
    }
  });
}

/** Loads and re-validates a stored crypt. A missing or corrupt record is `record-unreadable`. */
export async function loadCrypt(
  factory: IDBFactory | undefined,
  manifestId: string,
): Promise<StorageResult<CryptRecord>> {
  try {
    const opened = await openDb(factory);
    if (!opened.ok) return opened;
    try {
      return await runLoad(opened.value, manifestId);
    } finally {
      opened.value.close();
    }
  } catch {
    return storageError('storage-unavailable');
  }
}
