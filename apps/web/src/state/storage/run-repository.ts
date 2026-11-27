import type { Event, RunSettings } from '@escape-the-crypt/core';
import { openDb, RUNS_BY_STATUS_INDEX, STORES } from './db';
import { eventGuard } from './event-guard';
import { parseEventRow, parseRunRecord } from './records';
import type { EventRow, RunRecord } from './records';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

type StoreName = (typeof STORES)[keyof typeof STORES];
type Factory = IDBFactory | undefined;

export interface CreateRunInput {
  readonly runId: string;
  readonly manifestId: string;
  readonly settings: RunSettings;
  /** Epoch ms, supplied by the caller. */
  readonly createdAt: number;
}

/** Sets the outcome from inside a request callback. The first error outcome wins. */
type Settle<T> = (outcome: StorageResult<T>) => void;

/**
 * Runs `body` in one transaction and resolves with the outcome it set once the transaction
 * completes. An abort resolves `quota-exceeded` or `write-failed`, unless the body already set
 * an error. Never throws and never rejects.
 */
function runTx<T>(
  db: IDBDatabase,
  stores: readonly StoreName[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction, settle: Settle<T>) => void,
): Promise<StorageResult<T>> {
  const failKind = mode === 'readonly' ? 'storage-unavailable' : 'write-failed';
  return new Promise((resolve) => {
    let outcome: StorageResult<T> | null = null;
    const settle: Settle<T> = (next) => {
      if (outcome === null || (outcome.ok && !next.ok)) outcome = next;
    };
    let tx: IDBTransaction;
    try {
      tx = db.transaction([...stores], mode);
    } catch {
      resolve(storageError(failKind));
      return;
    }
    tx.oncomplete = () => resolve(outcome ?? storageError(failKind));
    tx.onabort = () => {
      if (outcome !== null && !outcome.ok) {
        resolve(outcome);
      } else {
        resolve(storageError(tx.error?.name === 'QuotaExceededError' ? 'quota-exceeded' : failKind));
      }
    };
    tx.onerror = () => {
      // The abort handler resolves.
    };
    try {
      body(tx, settle);
    } catch {
      settle(storageError(failKind));
      try {
        tx.abort();
      } catch {
        // Already finished.
      }
    }
  });
}

async function withDb<T>(
  factory: Factory,
  fallback: 'storage-unavailable' | 'write-failed',
  use: (db: IDBDatabase) => Promise<StorageResult<T>>,
): Promise<StorageResult<T>> {
  try {
    const opened = await openDb(factory);
    if (!opened.ok) return opened;
    try {
      return await use(opened.value);
    } finally {
      opened.value.close();
    }
  } catch {
    return storageError(fallback);
  }
}

const eventRange = (runId: string): IDBKeyRange => IDBKeyRange.bound([runId, 0], [runId, Infinity]);

/**
 * Creates an active run. The crypt must exist in the same transaction; otherwise nothing is
 * written and the result is `record-unreadable`.
 */
export function createRun(factory: Factory, input: CreateRunInput): Promise<StorageResult<RunRecord>> {
  const record: RunRecord = {
    schemaVersion: 1,
    runId: input.runId,
    manifestId: input.manifestId,
    settings: input.settings,
    createdAt: input.createdAt,
    status: 'active',
  };
  return withDb(factory, 'write-failed', (db) =>
    runTx<RunRecord>(db, [STORES.crypts, STORES.runs], 'readwrite', (tx, settle) => {
      const cryptReq = tx.objectStore(STORES.crypts).count(input.manifestId);
      cryptReq.onsuccess = () => {
        if (cryptReq.result === 0) {
          settle(storageError('record-unreadable'));
          return;
        }
        settle({ ok: true, value: record });
        tx.objectStore(STORES.runs).add(record);
      };
    }),
  );
}

/** Replaces only `status`. A missing run is `run-not-found`. */
export function setRunStatus(
  factory: Factory,
  runId: string,
  status: RunRecord['status'],
): Promise<StorageResult<RunRecord>> {
  return withDb(factory, 'write-failed', (db) =>
    runTx<RunRecord>(db, [STORES.runs], 'readwrite', (tx, settle) => {
      const store = tx.objectStore(STORES.runs);
      const req = store.get(runId);
      req.onsuccess = () => {
        if (req.result === undefined) {
          settle(storageError('run-not-found'));
          return;
        }
        const existing = parseRunRecord(req.result);
        if (!existing.ok) {
          settle(existing);
          return;
        }
        const next: RunRecord = { ...existing.value, status };
        settle({ ok: true, value: next });
        store.put(next);
      };
    }),
  );
}

/** One run by id. A missing run is `run-not-found`; a corrupt one is `record-unreadable`. */
export function loadRun(factory: Factory, runId: string): Promise<StorageResult<RunRecord>> {
  return withDb(factory, 'storage-unavailable', (db) =>
    runTx<RunRecord>(db, [STORES.runs], 'readonly', (tx, settle) => {
      const req = tx.objectStore(STORES.runs).get(runId);
      req.onsuccess = () => {
        settle(req.result === undefined ? storageError('run-not-found') : parseRunRecord(req.result));
      };
    }),
  );
}

/** The `active` run with the greatest `createdAt`, or `null`. */
export function findResumable(factory: Factory): Promise<StorageResult<RunRecord | null>> {
  return withDb(factory, 'storage-unavailable', (db) =>
    runTx<RunRecord | null>(db, [STORES.runs], 'readonly', (tx, settle) => {
      const req = tx.objectStore(STORES.runs).index(RUNS_BY_STATUS_INDEX).getAll('active');
      req.onsuccess = () => {
        let best: RunRecord | null = null;
        for (const raw of req.result as unknown[]) {
          const parsed = parseRunRecord(raw);
          if (!parsed.ok) {
            settle(parsed);
            return;
          }
          if (best === null || parsed.value.createdAt > best.createdAt) best = parsed.value;
        }
        settle({ ok: true, value: best });
      };
    }),
  );
}

/**
 * Reads the next `seq` and adds the row in one readwrite transaction. `add` fails on a duplicate
 * key, so an existing row is never overwritten. There is no update or single-row delete.
 */
export function appendEvent(
  factory: Factory,
  runId: string,
  event: Event,
): Promise<StorageResult<{ seq: number }>> {
  return withDb(factory, 'write-failed', (db) =>
    runTx<{ seq: number }>(db, [STORES.runs, STORES.events], 'readwrite', (tx, settle) => {
      const runReq = tx.objectStore(STORES.runs).count(runId);
      runReq.onsuccess = () => {
        if (runReq.result === 0) {
          settle(storageError('run-not-found'));
          return;
        }
        const events = tx.objectStore(STORES.events);
        const countReq = events.count(eventRange(runId));
        countReq.onsuccess = () => {
          const seq = countReq.result;
          const row: EventRow = { schemaVersion: 1, runId, seq, event };
          settle({ ok: true, value: { seq } });
          events.add(row);
        };
      };
    }),
  );
}

/** Rows in key order, each parsed, with seqs exactly `0..n-1` (`event-log-gap` otherwise). */
export function loadEvents(factory: Factory, runId: string): Promise<StorageResult<readonly EventRow[]>> {
  return withDb(factory, 'storage-unavailable', (db) =>
    runTx<readonly EventRow[]>(db, [STORES.events], 'readonly', (tx, settle) => {
      const req = tx.objectStore(STORES.events).getAll(eventRange(runId));
      req.onsuccess = () => {
        const rows: EventRow[] = [];
        for (const raw of req.result as unknown[]) {
          const parsed = parseEventRow(raw, eventGuard);
          if (!parsed.ok) {
            settle(parsed);
            return;
          }
          rows.push(parsed.value);
        }
        if (rows.some((row, index) => row.seq !== index)) {
          settle(storageError('event-log-gap'));
          return;
        }
        settle({ ok: true, value: rows });
      };
    }),
  );
}

/** The one deletion path: events, runs and the crypt, in one transaction. */
export function deleteCrypt(factory: Factory, manifestId: string): Promise<StorageResult<true>> {
  return withDb(factory, 'write-failed', (db) =>
    runTx<true>(db, [STORES.crypts, STORES.runs, STORES.events], 'readwrite', (tx, settle) => {
      const runs = tx.objectStore(STORES.runs);
      const events = tx.objectStore(STORES.events);
      const runsReq = runs.getAll();
      runsReq.onsuccess = () => {
        for (const raw of runsReq.result as unknown[]) {
          const candidate = raw as { runId?: unknown; manifestId?: unknown };
          if (candidate.manifestId !== manifestId || typeof candidate.runId !== 'string') continue;
          events.delete(eventRange(candidate.runId));
          runs.delete(candidate.runId);
        }
        tx.objectStore(STORES.crypts).delete(manifestId);
        settle({ ok: true, value: true });
      };
    }),
  );
}
