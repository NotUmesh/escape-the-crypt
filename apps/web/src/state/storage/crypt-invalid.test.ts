import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { openDb, STORES } from './db';

type Json = Record<string, unknown>;

function clone(): { manifest: Json; content: { questions: Json; concepts: Json } } {
  return structuredClone(SAMPLE_BUNDLE) as unknown as {
    manifest: Json;
    content: { questions: Json; concepts: Json };
  };
}

/** Bundles that `parseCryptBundle` must reject, built by breaking the valid sample bundle. */
const invalidBundleArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything(),
  fc.constant({}),
  fc.constantFrom(null, undefined, 'bundle', 42, []),
  fc.anything().map((manifest) => ({ manifest, content: SAMPLE_BUNDLE.content })),
  fc.anything().map((content) => ({ manifest: SAMPLE_BUNDLE.manifest, content })),
  fc.nat().map((n) => {
    const b = clone();
    const ids = Object.keys(b.content.questions);
    delete b.content.questions[ids[n % ids.length] as string];
    return b;
  }),
  fc.nat().map((n) => {
    const b = clone();
    const ids = Object.keys(b.content.concepts);
    delete b.content.concepts[ids[n % ids.length] as string];
    return b;
  }),
  fc.anything().map((junk) => {
    const b = clone();
    b.content.questions = { q: junk } as Json;
    return b;
  }),
);

async function countCrypts(factory: IDBFactory): Promise<number> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    return await new Promise<number>((resolve, reject) => {
      const req = db.transaction(STORES.crypts, 'readonly').objectStore(STORES.crypts).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('count failed'));
    });
  } finally {
    db.close();
  }
}

describe('saveCrypt with invalid crypts', () => {
  // Feature: persistence, Property 3: Invalid crypts are never written
  // **Validates: Requirements 2.4, 2.5**
  it('returns crypt-invalid and leaves the crypts store unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(invalidBundleArb, fc.boolean(), async (bundle, seeded) => {
        const factory = new IDBFactory();
        let expected = 0;
        if (seeded) {
          const first = await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' });
          expect(first.ok).toBe(true);
          expected = 1;
        }
        const result = await saveCrypt(factory, { bundle, source: 'generated', documentDigest: 'd' });
        expect(result).toEqual({ ok: false, error: { kind: 'crypt-invalid' } });
        expect(await countCrypts(factory)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('does not create the database when the crypt is invalid', async () => {
    const factory = new IDBFactory();
    const result = await saveCrypt(factory, { bundle: { manifest: {}, content: {} }, source: 'sample' });
    expect(result).toEqual({ ok: false, error: { kind: 'crypt-invalid' } });
    expect(await factory.databases()).toEqual([]);
  });
});
