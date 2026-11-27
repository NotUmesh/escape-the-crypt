import fc from 'fast-check';
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { runSettingsArb } from './persistence-arbitraries';
import type { RunRecord } from './records';
import { createRun, findResumable, setRunStatus } from './run-repository';

const statusArb = fc.constantFrom<RunRecord['status']>('active', 'escaped', 'left');

// Small createdAt range so ties are common.
const runSpecArb = fc.record({
  status: statusArb,
  createdAt: fc.integer({ min: 0, max: 6 }),
  settings: runSettingsArb,
});

describe('findResumable', () => {
  // The repository builds key ranges from the global IDBKeyRange, which jsdom does not provide.
  beforeAll(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  });

  // Feature: persistence, Property 19: The resumable run is the most recent active one
  it('returns the active run with the greatest createdAt, or null when none is active', async () => {
    // **Validates: Requirements 10.1**
    await fc.assert(
      fc.asyncProperty(fc.array(runSpecArb, { maxLength: 8 }), async (specs) => {
        const factory = new IDBFactory();
        expect((await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' })).ok).toBe(true);
        for (const [index, spec] of specs.entries()) {
          const runId = `run-${index}`;
          const created = await createRun(factory, {
            runId,
            manifestId: SAMPLE_BUNDLE.manifest.manifestId,
            settings: spec.settings,
            createdAt: spec.createdAt,
          });
          expect(created.ok).toBe(true);
          if (spec.status !== 'active') {
            expect((await setRunStatus(factory, runId, spec.status)).ok).toBe(true);
          }
        }

        const active = specs
          .map((spec, index) => ({ ...spec, runId: `run-${index}` }))
          .filter((spec) => spec.status === 'active');
        const result = await findResumable(factory);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        if (active.length === 0) {
          expect(result.value).toBeNull();
          return;
        }
        const maxCreatedAt = Math.max(...active.map((spec) => spec.createdAt));
        const tied = active.filter((spec) => spec.createdAt === maxCreatedAt).map((spec) => spec.runId);
        expect(result.value).not.toBeNull();
        expect(result.value?.status).toBe('active');
        expect(result.value?.createdAt).toBe(maxCreatedAt);
        expect(tied).toContain(result.value?.runId);
      }),
      { numRuns: 30 },
    );
  });
});
