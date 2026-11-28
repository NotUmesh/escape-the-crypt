import { afterEach, describe, expect, it } from 'vitest';
import { runRoomPipeline, type PipelineResult } from '@escape-the-crypt/core';
import type { RunPipeline } from './job-runner';

type PipelineNotices = NonNullable<PipelineResult['notices']>;
import { TOKEN, closeAll, heartBody, startHarness, type Harness } from './http-test-support';

afterEach(closeAll);

const NOTICES: PipelineNotices = {
  excluded: [
    {
      conceptId: 'c1',
      conceptTitle: 'Valves',
      source: 'code',
      passages: [
        { chunkId: 'k1', quote: 'one' },
        { chunkId: 'k2', quote: 'two' },
      ],
    },
  ],
  sufficiency: null,
};

/** Runs the recorded heart pipeline, then attaches `notices` (or leaves them absent). */
function withNotices(notices: PipelineNotices | undefined): RunPipeline {
  return async (notes, options) => {
    const result = await runRoomPipeline(notes, options);
    if (!result.ok || notices === undefined) return result;
    return { ok: true, value: { ...result.value, notices } };
  };
}

async function completed(h: Harness): Promise<string> {
  const created = await h.post(heartBody);
  const jobId = (created.json as { jobId: string }).jobId;
  const done = await h.waitDone(jobId);
  expect((done.json as { status: string }).status).toBe('completed');
  return jobId;
}

const getWith = (h: Harness, jobId: string, query: string) =>
  h.request(`/jobs/${jobId}${query}`, { headers: { 'X-Session-Token': TOKEN } });

describe('GET /jobs/:id notices', () => {
  it('adds notices only when asked with ?notices=1', async () => {
    const h = await startHarness({ runPipeline: withNotices(NOTICES) });
    const jobId = await completed(h);

    const plain = await getWith(h, jobId, '');
    const asked = await getWith(h, jobId, '?notices=1');
    const other = await getWith(h, jobId, '?notices=0');

    expect((plain.json as { bundle: object }).bundle).not.toHaveProperty('notices');
    expect((other.json as { bundle: object }).bundle).not.toHaveProperty('notices');
    expect((asked.json as { bundle: { notices: unknown } }).bundle.notices).toEqual(NOTICES);
    expect(asked.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers a bundle without notices byte-identically with or without the query', async () => {
    const h = await startHarness({ runPipeline: withNotices(undefined) });
    const jobId = await completed(h);
    const plain = await getWith(h, jobId, '');
    const asked = await getWith(h, jobId, '?notices=1');
    expect(asked.text).toBe(plain.text);
    expect(plain.text).not.toContain('notices');
  });

  it('logs only the conflict counts, never a title or quote', async () => {
    const h = await startHarness({ runPipeline: withNotices(NOTICES) });
    await completed(h);
    const line = h.logs.find((l) => l['status'] === 'completed');
    expect(line).toMatchObject({ conflictRoomsChecked: 0, conflictRoomsUnchecked: 0, conceptsExcludedByConflict: 0 });
    expect(JSON.stringify(h.logs)).not.toContain('Valves');
  });
});
