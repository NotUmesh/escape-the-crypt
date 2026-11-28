import type { Event } from '@escape-the-crypt/core';
import { canonicalJson } from './crypt-repository';
import { openDb, STORES } from './db';
import type { CryptRecord, EventRow, RunRecord } from './records';
import type { StorageErrorKind } from './storage-error';

type Factory = IDBFactory | undefined;

export type ImportWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'duplicate' | 'conflict' | StorageErrorKind };

export interface ImportWriteInput {
  readonly crypt: CryptRecord;
  readonly run: RunRecord;
  readonly events: readonly Event[];
}

/**
 * Writes an imported crypt, its run and every event in one readwrite transaction, or nothing.
 * It only ever adds. A crypt that is already stored is never replaced: an identical one is a
 * `duplicate` and a different one with the same identity is a `conflict`, and in both cases the
 * transaction writes nothing. An abort (quota, a clashing key) rolls the whole import back. Never
 * throws.
 */
export async function writeImport(factory: Factory, input: ImportWriteInput): Promise<ImportWriteResult> {
  const opened = await openDb(factory);
  if (!opened.ok) return { ok: false, kind: opened.error.kind };
  const db = opened.value;
  try {
    return await new Promise<ImportWriteResult>((resolve) => {
      let outcome: ImportWriteResult | null = null;
      let tx: IDBTransaction;
      try {
        tx = db.transaction([STORES.crypts, STORES.runs, STORES.events], 'readwrite');
      } catch {
        resolve({ ok: false, kind: 'write-failed' });
        return;
      }
      tx.oncomplete = () => resolve(outcome ?? { ok: false, kind: 'write-failed' });
      tx.onabort = () =>
        resolve({ ok: false, kind: tx.error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'write-failed' });
      tx.onerror = () => {
        // The abort handler resolves.
      };
      try {
        const crypts = tx.objectStore(STORES.crypts);
        const existing = crypts.get(input.crypt.manifestId);
        existing.onsuccess = () => {
          if (existing.result !== undefined) {
            const same = canonicalJson(existing.result) === canonicalJson(input.crypt);
            outcome = { ok: false, kind: same ? 'duplicate' : 'conflict' };
            return;
          }
          outcome = { ok: true };
          crypts.add(input.crypt);
          tx.objectStore(STORES.runs).add(input.run);
          const events = tx.objectStore(STORES.events);
          input.events.forEach((event, seq) => {
            const row: EventRow = { schemaVersion: 1, runId: input.run.runId, seq, event };
            events.add(row);
          });
        };
      } catch {
        outcome = { ok: false, kind: 'write-failed' };
        try {
          tx.abort();
        } catch {
          // Already finished.
        }
      }
    });
  } catch {
    return { ok: false, kind: 'write-failed' };
  } finally {
    db.close();
  }
}
