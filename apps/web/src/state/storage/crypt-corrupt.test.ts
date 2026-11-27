import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { loadCrypt } from './crypt-repository';
import { openDb, STORES } from './db';

type Json = Record<string, unknown>;

const MANIFEST_ID = SAMPLE_BUNDLE.manifest.manifestId;

function validRecord(): Json {
  return structuredClone({
    schemaVersion: 1,
    manifestId: MANIFEST_ID,
    manifest: SAMPLE_BUNDLE.manifest,
    content: SAMPLE_BUNDLE.content,
    source: 'sample',
  }) as Json;
}

function withContent(mutate: (content: { questions: Json; concepts: Json }) => void): Json {
  const record = validRecord();
  mutate(record.content as { questions: Json; concepts: Json });
  return record;
}

/** A stored record for `MANIFEST_ID` that is broken in its envelope, manifest or content. */
const corruptRecordArb: fc.Arbitrary<Json> = fc.oneof(
  fc.anything().filter((v) => v !== 1).map((v) => ({ ...validRecord(), schemaVersion: v })),
  fc.anything().map((v) => ({ ...validRecord(), source: v })).filter((r) => r.source !== 'sample' && r.source !== 'generated'),
  fc.constantFrom('', 0, null, 7, {}).map((v) => ({ ...validRecord(), documentDigest: v })),
  fc.constantFrom('manifest', 'content', 'source', 'schemaVersion').map((key) => {
    const record = validRecord();
    delete record[key];
    return record;
  }),
  fc.anything().map((v) => ({ ...validRecord(), manifest: v })),
  fc.anything().map((v) => ({ ...validRecord(), content: v })),
  fc.nat().map((n) =>
    withContent((c) => {
      const ids = Object.keys(c.questions);
      delete c.questions[ids[n % ids.length] as string];
    }),
  ),
  fc.nat().map((n) =>
    withContent((c) => {
      const ids = Object.keys(c.concepts);
      delete c.concepts[ids[n % ids.length] as string];
    }),
  ),
  fc.anything().map((junk) => withContent((c) => void (c.questions = { q: junk }))),
  // The stored key disagrees with the manifest's own id.
  fc.string({ minLength: 1 }).filter((s) => s !== MANIFEST_ID).map((id) => ({ ...validRecord(), manifestId: id })),
);

async function putRaw(factory: IDBFactory, record: Json): Promise<void> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.crypts, 'readwrite');
      tx.objectStore(STORES.crypts).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('put failed'));
      tx.onabort = () => reject(new Error('put aborted'));
    });
  } finally {
    db.close();
  }
}

async function readRaw(factory: IDBFactory, key: string): Promise<unknown> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORES.crypts, 'readonly').objectStore(STORES.crypts).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('get failed'));
    });
  } finally {
    db.close();
  }
}

describe('loadCrypt with corrupted stored crypts', () => {
  // Feature: persistence, Property 5: Corrupted stored crypts are rejected on read
  // **Validates: Requirements 2.8**
  it('returns record-unreadable and leaves the stored bytes unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(corruptRecordArb, async (record) => {
        const factory = new IDBFactory();
        await putRaw(factory, record);
        const key = record.manifestId as string;
        const stored = await readRaw(factory, key);

        const result = await loadCrypt(factory, key);

        expect(result).toEqual({ ok: false, error: { kind: 'record-unreadable' } });
        expect(await readRaw(factory, key)).toEqual(stored);
      }),
      { numRuns: 100 },
    );
  });

  it('accepts the uncorrupted record, so the mutations are what cause the rejection', async () => {
    const factory = new IDBFactory();
    await putRaw(factory, validRecord());
    const result = await loadCrypt(factory, MANIFEST_ID);
    expect(result.ok).toBe(true);
  });
});
