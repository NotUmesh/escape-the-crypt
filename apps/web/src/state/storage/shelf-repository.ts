import { openDb, STORES } from './db';
import { parseCryptRecord, parseRunRecord } from './records';
import type { CryptRecord, RunRecord } from './records';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

type Factory = IDBFactory | undefined;

/**
 * One saved crypt on the desk's book stack (front-of-house brief §9). Field for field the shape
 * `features/desk/shelf-entry.ts` declares, so the desk can take it as it is. No study text: the
 * title a book shows comes from fixed copy chosen by `source` (the existing title rule), never from
 * the notes or the questions.
 */
export interface ShelfEntry {
  readonly manifestId: string;
  /** The crypt's latest run, or null when the crypt has no readable run. */
  readonly runId: string | null;
  /** The latest run's status. A crypt with no readable run reads as not finished. */
  readonly status: 'active' | 'escaped' | 'left';
  /** Epoch ms of the latest run's start: when the crypt was last played. 0 when it has no run. */
  readonly createdAt: number;
  readonly source: 'sample' | 'generated';
  readonly roomCount: number;
  /** Not computed yet: core has no review-due selector, so the chip stays hidden (brief §9). */
  readonly dueConceptCount?: number;
}

/** The latest run of each crypt, by `createdAt`. */
function latestRuns(runs: readonly RunRecord[]): Map<string, RunRecord> {
  const latest = new Map<string, RunRecord>();
  for (const run of runs) {
    const seen = latest.get(run.manifestId);
    if (seen === undefined || run.createdAt > seen.createdAt) latest.set(run.manifestId, run);
  }
  return latest;
}

/** Pure: crypts and runs to shelf entries, most recently played first. */
export function shelfEntries(crypts: readonly CryptRecord[], runs: readonly RunRecord[]): ShelfEntry[] {
  const latest = latestRuns(runs);
  const entries = crypts.map((crypt): ShelfEntry => {
    const run = latest.get(crypt.manifestId);
    return {
      manifestId: crypt.manifestId,
      runId: run?.runId ?? null,
      status: run?.status ?? 'left',
      createdAt: run?.createdAt ?? 0,
      source: crypt.source,
      roomCount: crypt.manifest.rooms.length,
    };
  });
  // Newest play first; ties (and crypts with no run) by manifest ID, so the order is stable.
  return entries.sort((a, b) => b.createdAt - a.createdAt || a.manifestId.localeCompare(b.manifestId));
}

/**
 * Every saved crypt as a shelf entry, most recently played first. Reads only, in one readonly
 * transaction. A record that does not parse is left off the shelf rather than hiding every book;
 * a database that cannot be opened is `storage-unavailable`. Never throws.
 */
export async function listShelf(factory: Factory): Promise<StorageResult<readonly ShelfEntry[]>> {
  try {
    const opened = await openDb(factory);
    if (!opened.ok) return opened;
    const db = opened.value;
    try {
      const raw = await new Promise<{ crypts: unknown[]; runs: unknown[] } | null>((resolve) => {
        let crypts: unknown[] = [];
        let runs: unknown[] = [];
        let tx: IDBTransaction;
        try {
          tx = db.transaction([STORES.crypts, STORES.runs], 'readonly');
        } catch {
          resolve(null);
          return;
        }
        const cryptReq = tx.objectStore(STORES.crypts).getAll();
        cryptReq.onsuccess = () => {
          crypts = cryptReq.result as unknown[];
        };
        const runReq = tx.objectStore(STORES.runs).getAll();
        runReq.onsuccess = () => {
          runs = runReq.result as unknown[];
        };
        tx.oncomplete = () => resolve({ crypts, runs });
        tx.onabort = () => resolve(null);
      });
      if (raw === null) return storageError('storage-unavailable');
      const crypts = raw.crypts.flatMap((r) => {
        const parsed = parseCryptRecord(r);
        return parsed.ok ? [parsed.value] : [];
      });
      const runs = raw.runs.flatMap((r) => {
        const parsed = parseRunRecord(r);
        return parsed.ok ? [parsed.value] : [];
      });
      return { ok: true, value: shelfEntries(crypts, runs) };
    } finally {
      db.close();
    }
  } catch {
    return storageError('storage-unavailable');
  }
}
