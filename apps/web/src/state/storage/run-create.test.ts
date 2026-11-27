import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { runSettingsArb } from './persistence-arbitraries';
import { createRun, findResumable } from './run-repository';

const idArb = fc.stringMatching(/^[a-z0-9-]{1,24}$/);
const createdAtArb = fc.integer({ min: 0, max: 4_000_000_000_000 });

// Feature: persistence, Property 6: Run creation requires an existing crypt and round-trips its fields
describe('run creation', () => {
  it('succeeds and round-trips exactly when the crypt exists, otherwise writes nothing', async () => {
    // **Validates: Requirements 3.1, 3.2, 4.7**
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        idArb,
        idArb,
        runSettingsArb,
        createdAtArb,
        async (cryptExists, runId, otherId, settings, createdAt) => {
          const factory = new IDBFactory();
          const saved = await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' });
          expect(saved.ok).toBe(true);
          const manifestId = cryptExists ? SAMPLE_BUNDLE.manifest.manifestId : `missing-${otherId}`;

          const created = await createRun(factory, { runId, manifestId, settings, createdAt });
          const resumable = await findResumable(factory);
          expect(resumable.ok).toBe(true);
          if (!resumable.ok) return;

          if (cryptExists) {
            const expected = { schemaVersion: 1, runId, manifestId, settings, createdAt, status: 'active' };
            expect(created).toEqual({ ok: true, value: expected });
            expect(resumable.value).toEqual(expected);
          } else {
            expect(created.ok).toBe(false);
            expect(resumable.value).toBeNull();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
