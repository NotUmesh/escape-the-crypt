import fc from 'fast-check';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_COPY, chunkDocument, errorMessage, makeNotesRecord } from '@escape-the-crypt/core';
import type { Chunk, NotesRecord } from '@escape-the-crypt/core';
import { DB_VERSION } from '../../state/storage/db';
import { DB_NAME, NOTES_STORE_NAME, createIdbStore } from './notes-store-idb';
import { createMemoryStore } from './notes-store-memory';
import { createSessionStore } from './notes-store';

afterEach(() => vi.restoreAllMocks());

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

/** Counts records in the real `notes` object store of a (fake) IndexedDB. */
function countRecords(factory: IDBFactory): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DB_NAME, DB_VERSION);
    open.onerror = () => reject(new Error('open failed'));
    open.onsuccess = () => {
      const request = open.result.transaction(NOTES_STORE_NAME).objectStore(NOTES_STORE_NAME).count();
      request.onsuccess = () => {
        open.result.close();
        resolve(request.result);
      };
    };
  });
}

describe('Property 21: Notes record round trip', () => {
  /** **Validates: Requirements 18.1, 18.2, 18.9** */
  it('loads back the same chunks, schema version and only the allowed fields', async () => {
    await fc.assert(
      fc.asyncProperty(chunkSet, async (chunks) => {
        const store = createIdbStore(new IDBFactory());
        const record = makeNotesRecord(chunks);
        expect(await store.save(record)).toEqual({ ok: true, value: true });
        const loaded = await store.load(record.documentDigest);
        expect(loaded).toEqual({ ok: true, value: record });
        if (loaded.ok && loaded.value !== null) {
          expect(Object.keys(loaded.value).sort()).toEqual(['chunks', 'documentDigest', 'schemaVersion']);
          expect(loaded.value.schemaVersion).toBe(1);
          expect(loaded.value.chunks).toEqual(chunks);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('returns null for a digest that was never saved', async () => {
    const store = createIdbStore(new IDBFactory());
    expect(await store.load('f'.repeat(64))).toEqual({ ok: true, value: null });
  });
});

describe('Property 22: Saving the same digest replaces the record', () => {
  /** **Validates: Requirements 18.4** */
  it('leaves exactly one record and loads the second chunk set', async () => {
    await fc.assert(
      fc.asyncProperty(chunkSet, async (first) => {
        // Same document, so the same digest; the second set differs in its edited flags.
        const second = first.map((c) => ({ ...c, edited: !c.edited }));
        const factory = new IDBFactory();
        const store = createIdbStore(factory);
        const a = makeNotesRecord(first);
        const b = makeNotesRecord(second);
        expect(b.documentDigest).toBe(a.documentDigest);
        await store.save(a);
        await store.save(b);
        expect(await countRecords(factory)).toBe(1);
        expect(await store.load(a.documentDigest)).toEqual({ ok: true, value: b });
      }),
      { numRuns: 25 },
    );
  });
});

describe('Property 23: Storage failure keeps notes in the session', () => {
  type FailureSetup = () => IDBFactory | undefined;
  const failures: ReadonlyArray<readonly [string, FailureSetup]> = [
    ['indexedDB is undefined', () => undefined],
    [
      'open fails',
      () =>
        ({
          open: () => {
            const request = {} as IDBOpenDBRequest;
            queueMicrotask(() => request.onerror?.(new Event('error')));
            return request;
          },
        }) as unknown as IDBFactory,
    ],
    [
      'open throws',
      () =>
        ({
          open: () => {
            throw new DOMException('denied', 'SecurityError');
          },
        }) as unknown as IDBFactory,
    ],
    [
      'the write aborts',
      () => {
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
          this.transaction.abort();
          return {} as IDBRequest;
        });
        return new IDBFactory();
      },
    ],
    [
      'the write hits the quota',
      () => {
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
          throw new DOMException('full', 'QuotaExceededError');
        });
        return new IDBFactory();
      },
    ],
  ];

  for (const [name, setup] of failures) {
    /** **Validates: Requirements 18.8** */
    it(`when ${name}: reports storage-unavailable and keeps the chunks loadable from the session`, async () => {
      await fc.assert(
        fc.asyncProperty(chunkSet, async (chunks) => {
          const memory = createMemoryStore();
          const session = createSessionStore(createIdbStore(setup()), memory);
          const record: NotesRecord = makeNotesRecord(chunks);
          expect(await session.save(record)).toEqual({ ok: false, error: { kind: 'storage-unavailable' } });
          expect(await memory.load(record.documentDigest)).toEqual({ ok: true, value: record });
          expect(await session.load(record.documentDigest)).toEqual({ ok: true, value: record });
        }),
        { numRuns: 10 },
      );
    });
  }

  /** **Validates: Requirements 18.8** */
  it('maps the failure to a message that says what happened and what to do next', () => {
    const copy = ERROR_COPY['storage-unavailable'];
    expect(copy.what.length).toBeGreaterThan(0);
    expect(copy.next.length).toBeGreaterThan(0);
    expect(errorMessage({ kind: 'storage-unavailable' })).toBe(`${copy.what} ${copy.next}`);
    expect(errorMessage({ kind: 'storage-unavailable' })).toContain('your notes');
  });
});

describe('unreadable stored records', () => {
  it('reports a record from a newer schema as unavailable and leaves it in place', async () => {
    const factory = new IDBFactory();
    const store = createIdbStore(factory);
    const record = makeNotesRecord(
      chunkDocument({ sourceType: 'paste', text: 'One sentence long enough to become a chunk here.', originalText: 'One sentence long enough to become a chunk here.' }),
    );
    await store.save({ ...record, schemaVersion: 2 });
    expect(await store.load(record.documentDigest)).toEqual({ ok: false, error: { kind: 'storage-unavailable' } });
    expect(await countRecords(factory)).toBe(1);
  });
});