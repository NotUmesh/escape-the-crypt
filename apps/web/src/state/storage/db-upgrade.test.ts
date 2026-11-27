import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { chunkDocument, makeNotesRecord } from '@escape-the-crypt/core';
import type { Chunk, NotesRecord } from '@escape-the-crypt/core';
import { DB_NAME, STORES, openDb } from './db';

const sentence = fc
  .array(fc.stringMatching(/^[A-Za-z]{3,10}$/), { minLength: 9, maxLength: 24 })
  .map((words) => `${words.join(' ')}.`);

/** Chunk sets produced by the real Chunker from generated paragraphs. */
const chunkSet: fc.Arbitrary<Chunk[]> = fc
  .array(sentence, { minLength: 1, maxLength: 5 })
  .map((paragraphs) => {
    const text = paragraphs.join('\n\n');
    return chunkDocument({ sourceType: 'paste', text, originalText: text });
  })
  .filter((chunks) => chunks.length > 0);

/** Generated notes records with distinct digests. */
const notesRecords: fc.Arbitrary<NotesRecord[]> = fc
  .array(chunkSet, { minLength: 0, maxLength: 4 })
  .map((sets) => {
    const byDigest = new Map<string, NotesRecord>();
    for (const chunks of sets) {
      const record = makeNotesRecord(chunks);
      byDigest.set(record.documentDigest, record);
    }
    return [...byDigest.values()];
  });

/** Builds a version 1 database (only the `notes` store) holding the given records. */
function seedV1(factory: IDBFactory, records: readonly NotesRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORES.notes, { keyPath: 'documentDigest' });
    };
    request.onerror = () => reject(new Error('v1 open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORES.notes, 'readwrite');
      const store = tx.objectStore(STORES.notes);
      for (const record of records) store.put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(new Error('v1 write failed'));
    };
  });
}

function readAllNotes(db: IDBDatabase): Promise<NotesRecord[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORES.notes).objectStore(STORES.notes).getAll();
    request.onsuccess = () => resolve(request.result as NotesRecord[]);
    request.onerror = () => reject(new Error('read failed'));
  });
}

async function upgradeAndRead(records: readonly NotesRecord[]): Promise<NotesRecord[]> {
  const factory = new IDBFactory();
  await seedV1(factory, records);
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error(`upgrade failed: ${opened.error.kind}`);
  try {
    expect(opened.value.version).toBe(2);
    for (const name of [STORES.crypts, STORES.runs, STORES.events]) {
      expect(opened.value.objectStoreNames.contains(name)).toBe(true);
    }
    return await readAllNotes(opened.value);
  } finally {
    opened.value.close();
  }
}

const byDigest = (a: NotesRecord, b: NotesRecord): number => a.documentDigest.localeCompare(b.documentDigest);

describe('Property 1: Notes records survive the v1-to-v2 upgrade', () => {
  // Feature: persistence, Property 1: Notes records survive the v1-to-v2 upgrade
  /** **Validates: Requirements 1.3** */
  it('returns every v1 notes record deep-equal after upgrading to v2', async () => {
    await fc.assert(
      fc.asyncProperty(notesRecords, async (records) => {
        const after = await upgradeAndRead(records);
        expect([...after].sort(byDigest)).toEqual([...records].sort(byDigest));
      }),
      { numRuns: 30 },
    );
  });
});

describe('Notes upgrade from version 1', () => {
  /** **Validates: Requirements 1.3, 12.6** */
  it('keeps every generated notes record deep-equal in a version 1 database', async () => {
    const records = fc.sample(notesRecords.filter((set) => set.length >= 2), { numRuns: 1, seed: 7 })[0] ?? [];
    expect(records.length).toBeGreaterThanOrEqual(2);
    const after = await upgradeAndRead(records);
    expect(after).toHaveLength(records.length);
    for (const record of records) {
      expect(after.find((r) => r.documentDigest === record.documentDigest)).toEqual(record);
    }
  });
});
