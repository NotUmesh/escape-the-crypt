import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { loadCrypt, saveCrypt } from './crypt-repository';
import { openDb, STORES } from './db';
import { startEventsFor } from './persistence-arbitraries';
import { appendEvent, createRun, deleteCrypt, loadEvents } from './run-repository';

const SETTINGS = { length: 'short', difficulty: 'apprentice', hintAllowance: 1 } as const;
const ID_A = 'crypt-delete-a';
const ID_B = 'crypt-delete-b';

function bundleWithId(manifestId: string): unknown {
  return { ...SAMPLE_BUNDLE, manifest: { ...SAMPLE_BUNDLE.manifest, manifestId } };
}

async function dumpStore(factory: IDBFactory, store: string): Promise<unknown[]> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(new Error('read failed'));
    });
  } finally {
    db.close();
  }
}

async function putNotes(factory: IDBFactory, record: unknown): Promise<void> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.notes, 'readwrite');
      tx.objectStore(STORES.notes).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('write failed'));
    });
  } finally {
    db.close();
  }
}

// Feature: persistence, Property 10: Deleting a crypt removes exactly its own rows
describe('deleting a crypt', () => {
  // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  it('removes only that crypt, its runs and its events, and leaves the other crypt and notes alone', async () => {
    // **Validates: Requirements 4.4**
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        async (runsA, runsB, extraEvents, deleteFirst) => {
          const factory = new IDBFactory();
          for (const id of [ID_A, ID_B]) {
            const saved = await saveCrypt(factory, { bundle: bundleWithId(id), source: 'sample' });
            expect(saved.ok).toBe(true);
          }
          const events = [
            ...startEventsFor(SAMPLE_BUNDLE.manifest),
            ...Array.from({ length: extraEvents }, () => startEventsFor(SAMPLE_BUNDLE.manifest)[3]!),
          ];
          const runIds: Record<string, string[]> = { [ID_A]: [], [ID_B]: [] };
          let createdAt = 1;
          for (const [id, count] of [[ID_A, runsA], [ID_B, runsB]] as const) {
            for (let i = 0; i < count; i += 1) {
              const runId = `${id}-run-${i}`;
              const created = await createRun(factory, { runId, manifestId: id, settings: SETTINGS, createdAt: createdAt++ });
              expect(created.ok).toBe(true);
              runIds[id]!.push(runId);
              for (const event of events) {
                const appended = await appendEvent(factory, runId, event);
                expect(appended).toEqual({ ok: true, value: expect.anything() });
              }
            }
          }
          const notes = { documentDigest: 'a'.repeat(64), marker: 'untouched' };
          await putNotes(factory, notes);

          const doomed = deleteFirst ? ID_A : ID_B;
          const kept = deleteFirst ? ID_B : ID_A;
          const keptEventsBefore = await Promise.all(runIds[kept]!.map((r) => loadEvents(factory, r)));
          const keptRunsBefore = (await dumpStore(factory, STORES.runs)).filter(
            (r) => (r as { manifestId: string }).manifestId === kept,
          );
          const keptCryptBefore = await loadCrypt(factory, kept);
          const notesBefore = await dumpStore(factory, STORES.notes);

          const deleted = await deleteCrypt(factory, doomed);
          expect(deleted.ok).toBe(true);

          expect((await loadCrypt(factory, doomed)).ok).toBe(false);
          const runsAfter = (await dumpStore(factory, STORES.runs)) as { manifestId: string; runId: string }[];
          expect(runsAfter.filter((r) => r.manifestId === doomed)).toEqual([]);
          const eventsAfter = (await dumpStore(factory, STORES.events)) as { runId: string }[];
          for (const runId of runIds[doomed]!) {
            expect(eventsAfter.filter((e) => e.runId === runId)).toEqual([]);
          }

          expect(await loadCrypt(factory, kept)).toEqual(keptCryptBefore);
          expect(runsAfter.filter((r) => r.manifestId === kept)).toEqual(keptRunsBefore);
          const keptEventsAfter = await Promise.all(runIds[kept]!.map((r) => loadEvents(factory, r)));
          expect(keptEventsAfter).toEqual(keptEventsBefore);
          expect(await dumpStore(factory, STORES.notes)).toEqual(notesBefore);
          expect(notesBefore).toEqual([notes]);
        },
      ),
      { numRuns: 25 },
    );
  });
});
