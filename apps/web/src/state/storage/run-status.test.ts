import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { saveCrypt } from './crypt-repository';
import { openDb, STORES } from './db';
import { runSettingsArb } from './persistence-arbitraries';
import type { RunRecord } from './records';
import { createRun, setRunStatus } from './run-repository';

const statusArb = fc.constantFrom<RunRecord['status']>('active', 'escaped', 'left');
const idArb = fc.stringMatching(/^[a-z0-9-]{1,24}$/);

async function readRaw(factory: IDBFactory, store: string): Promise<unknown[]> {
  const opened = await openDb(factory);
  if (!opened.ok) throw new Error('open failed');
  const db = opened.value;
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction([store], 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(new Error('read failed'));
    });
  } finally {
    db.close();
  }
}

// Feature: persistence, Property 7: Status changes touch only status
describe('run status changes', () => {
  it('changes only status on a stored run', async () => {
    // **Validates: Requirements 3.5, 3.6**
    await fc.assert(
      fc.asyncProperty(
        idArb,
        runSettingsArb,
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.array(statusArb, { minLength: 1, maxLength: 4 }),
        async (runId, settings, createdAt, statuses) => {
          const factory = new IDBFactory();
          expect((await saveCrypt(factory, { bundle: SAMPLE_BUNDLE, source: 'sample' })).ok).toBe(true);
          const created = await createRun(factory, {
            runId,
            manifestId: SAMPLE_BUNDLE.manifest.manifestId,
            settings,
            createdAt,
          });
          expect(created.ok).toBe(true);
          if (!created.ok) return;
          for (const status of statuses) {
            const result = await setRunStatus(factory, runId, status);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toEqual({ ...created.value, status });
            const stored = await readRaw(factory, STORES.runs);
            expect(stored).toEqual([{ ...created.value, status }]);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('returns run-not-found and writes nothing for a missing run', async () => {
    await fc.assert(
      fc.asyncProperty(idArb, statusArb, async (runId, status) => {
        const factory = new IDBFactory();
        const result = await setRunStatus(factory, runId, status);
        expect(result).toEqual({ ok: false, error: { kind: 'run-not-found' } });
        expect(await readRaw(factory, STORES.runs)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });
});
