import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { parseCryptBundle } from '@escape-the-crypt/core';
import type { CryptBundle } from '@escape-the-crypt/core';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { canonicalJson, loadCrypt, saveCrypt } from './crypt-repository';
import { STORES, openDb } from './db';

const manifestIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);
const titleArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,30}[A-Za-z]$/);

function withId(manifestId: string): CryptBundle {
  return { manifest: { ...SAMPLE_BUNDLE.manifest, manifestId }, content: SAMPLE_BUNDLE.content };
}

/** Same manifestId, same manifest, but one concept title differs. */
function withTitle(bundle: CryptBundle, title: string): CryptBundle {
  const [conceptId] = Object.keys(bundle.content.concepts);
  return {
    manifest: bundle.manifest,
    content: {
      questions: bundle.content.questions,
      concepts: { ...bundle.content.concepts, [conceptId!]: { title } },
    },
  };
}

async function rawRecord(factory: IDBFactory, manifestId: string): Promise<string> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    return await new Promise<string>((resolve, reject) => {
      const req = db.transaction(STORES.crypts, 'readonly').objectStore(STORES.crypts).get(manifestId);
      req.onsuccess = () => resolve(canonicalJson(req.result));
      req.onerror = () => reject(new Error('read failed'));
    });
  } finally {
    db.close();
  }
}

// Feature: persistence, Property 4: Saving under an existing manifestId is conflict-checked
describe('manifest conflict check', () => {
  it('re-saving an identical crypt is a no-op; a differing crypt conflicts and changes nothing', async () => {
    // **Validates: Requirements 2.6, 2.7**
    await fc.assert(
      fc.asyncProperty(manifestIdArb, titleArb, async (manifestId, title) => {
        const bundle = withId(manifestId);
        const other = withTitle(bundle, title);
        fc.pre(canonicalJson(other) !== canonicalJson(bundle));
        fc.pre(parseCryptBundle(bundle).ok && parseCryptBundle(other).ok);

        const factory = new IDBFactory();
        const first = await saveCrypt(factory, { bundle, source: 'sample' });
        expect(first).toEqual({ ok: true, value: { manifestId } });
        const stored = await rawRecord(factory, manifestId);

        const again = await saveCrypt(factory, { bundle, source: 'sample' });
        expect(again).toEqual({ ok: true, value: { manifestId } });
        expect(await rawRecord(factory, manifestId)).toBe(stored);

        const differing = await saveCrypt(factory, { bundle: other, source: 'sample' });
        expect(differing.ok).toBe(false);
        if (!differing.ok) expect(differing.error.kind).toBe('manifest-conflict');
        expect(await rawRecord(factory, manifestId)).toBe(stored);

        const loaded = await loadCrypt(factory, manifestId);
        expect(loaded.ok).toBe(true);
        if (loaded.ok) expect(loaded.value.content).toEqual(bundle.content);
      }),
      { numRuns: 30 },
    );
  });
});
