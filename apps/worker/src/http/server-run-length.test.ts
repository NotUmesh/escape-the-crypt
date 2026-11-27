import { afterEach, describe, expect, it } from 'vitest';
import { cryptTargetFor, type CryptTarget, type RunLength } from '@escape-the-crypt/core';
import type { RunPipeline } from './job-runner';
import { HEART_NOTES, KEY, KEY_2, closeAll, failingPipeline, startHarness } from './http-test-support';

afterEach(closeAll);

/** Records the target each run was given, then fails cheaply (no provider call). */
function capturing(): { run: RunPipeline; targets: (CryptTarget | undefined)[] } {
  const targets: (CryptTarget | undefined)[] = [];
  const fail = failingPipeline({ kind: 'empty-room' });
  return {
    targets,
    run: (notes, options) => {
      targets.push(options.target);
      return fail(notes, options);
    },
  };
}

describe('POST /jobs: the run length sets the crypt target', () => {
  it.each(['short', 'standard', 'long'] as const)('passes cryptTargetFor(%s) to the pipeline', async (runLength: RunLength) => {
    const seen = capturing();
    const h = await startHarness({ runPipeline: seen.run });
    const created = await h.post({ notesText: HEART_NOTES, runLength });
    expect(created.status).toBe(202);
    await h.waitDone((created.json as { jobId: string }).jobId);
    expect(seen.targets).toEqual([cryptTargetFor(runLength)]);
  });

  it('stores the length on the job', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    const created = await h.post({ notesText: HEART_NOTES, runLength: 'long' });
    const view = h.store.get((created.json as { jobId: string }).jobId, 'tok-A_0123456789abcdefghij');
    expect(view?.kind === 'job' && view.job.runLength).toBe('long');
  });

  it('treats another length for the same key as a different request', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    await h.post({ notesText: HEART_NOTES, runLength: 'short' });
    const conflict = await h.post({ notesText: HEART_NOTES, runLength: 'long' });
    expect(conflict.status).toBe(409);
    const fresh = await h.post({ notesText: HEART_NOTES, runLength: 'long' }, { 'Idempotency-Key': KEY_2 });
    expect(fresh.status).toBe(202);
    expect(KEY).not.toBe(KEY_2);
  });
});
