import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { parseCryptBundle } from '@escape-the-crypt/core';
import type { CryptBundle, CryptContent, CryptManifest } from '@escape-the-crypt/core';
import { manifestArb } from '../../../../../packages/core/src/test-support/arbitraries';
import { cryptContentEntryArb } from '../../../../../packages/core/src/test-support/crypt-content-arbitraries';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { loadCrypt, saveCrypt } from './crypt-repository';

function questionIds(manifest: CryptManifest): string[] {
  const ids: string[] = [];
  for (const room of manifest.rooms) {
    for (const slot of room.lockSlots) {
      ids.push(slot.primaryQuestion.questionId);
      if (slot.alternateQuestion !== null) ids.push(slot.alternateQuestion.questionId);
    }
  }
  for (const slot of manifest.finalDoor.slots) ids.push(slot.question.questionId);
  return ids;
}

function conceptIds(manifest: CryptManifest): string[] {
  const ids = new Set<string>();
  for (const room of manifest.rooms) for (const slot of room.lockSlots) ids.add(slot.conceptId);
  for (const slot of manifest.finalDoor.slots) ids.add(slot.conceptId);
  return [...ids];
}

const titleArb = fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,30}[A-Za-z]$/);

/** A generated manifest with content covering every question and concept it names. */
const generatedBundleArb: fc.Arbitrary<CryptBundle> = manifestArb.chain((manifest) => {
  const qIds = [...new Set(questionIds(manifest))];
  const cIds = conceptIds(manifest);
  return fc
    .tuple(
      fc.array(cryptContentEntryArb, { minLength: qIds.length, maxLength: qIds.length }),
      fc.array(titleArb, { minLength: cIds.length, maxLength: cIds.length }),
    )
    .map(([entries, titles]): CryptBundle => {
      const content: CryptContent = {
        questions: Object.fromEntries(qIds.map((id, i) => [id, entries[i]!])),
        concepts: Object.fromEntries(cIds.map((id, i) => [id, { title: titles[i]! }])),
      };
      return { manifest, content };
    });
});

const digestArb = fc.option(fc.stringMatching(/^[0-9a-f]{64}$/), { nil: undefined });

// Feature: persistence, Property 2: Crypt save-then-load round trip
describe('crypt save-then-load round trip', () => {
  it('returns a deep-equal record for sample and generated crypts, with or without a digest', async () => {
    // **Validates: Requirements 2.1, 2.2, 2.3, 2.9, 4.7**
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(SAMPLE_BUNDLE), generatedBundleArb),
        fc.constantFrom<'sample' | 'generated'>('sample', 'generated'),
        digestArb,
        async (bundle, source, documentDigest) => {
          const parsed = parseCryptBundle(bundle);
          fc.pre(parsed.ok);
          const factory = new IDBFactory();
          const saved = await saveCrypt(factory, {
            bundle,
            source,
            ...(documentDigest === undefined ? {} : { documentDigest }),
          });
          expect(saved.ok).toBe(true);
          const loaded = await loadCrypt(factory, bundle.manifest.manifestId);
          expect(loaded.ok).toBe(true);
          if (!loaded.ok) return;
          const record = loaded.value;
          expect(record.schemaVersion).toBe(1);
          expect(record.manifest).toEqual(bundle.manifest);
          expect(record.content).toEqual(bundle.content);
          expect(record.source).toBe(source);
          expect(record.documentDigest).toBe(documentDigest);
          expect(Object.keys(record).sort()).toEqual(
            ['content', 'manifest', 'manifestId', 'schemaVersion', 'source', ...(documentDigest === undefined ? [] : ['documentDigest'])].sort(),
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});
