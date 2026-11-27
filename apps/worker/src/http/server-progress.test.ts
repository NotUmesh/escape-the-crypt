import { afterEach, describe, expect, it } from 'vitest';
import { JobStatusResponseSchema, z } from '@escape-the-crypt/core';
import type { PipelineProgress } from '@escape-the-crypt/core';
import { TOKEN, closeAll, deferred, heartBody, reportingPipeline, startHarness } from './http-test-support';

afterEach(closeAll);

/** The `running` body as a client built before progress existed parses it: strictly, no extra field. */
const OldRunningSchema = z.strictObject({ jobId: z.string().min(1), status: z.literal('running') });

describe('GET /jobs/:id: stage and counts', () => {
  const steps: PipelineProgress[] = [{ stage: 'extracting' }, { stage: 'generating', done: 0, total: 6 }, { stage: 'generating', done: 2, total: 6 }];

  it('reports the latest stage and real counts to a client that asks for them', async () => {
    const gate = deferred();
    const h = await startHarness({ runPipeline: reportingPipeline(steps, gate) });
    const jobId = ((await h.post(heartBody)).json as { jobId: string }).jobId;
    const res = await h.request(`/jobs/${jobId}?progress=1`, { headers: { 'X-Session-Token': TOKEN } });
    expect(res.json).toEqual({ jobId, status: 'running', progress: { stage: 'generating', done: 2, total: 6 } });
    expect(JobStatusResponseSchema.safeParse(res.json).success).toBe(true);
    gate.release();
  });

  it('keeps old clients working: without ?progress=1 the running body is exactly as before', async () => {
    const gate = deferred();
    const h = await startHarness({ runPipeline: reportingPipeline(steps, gate) });
    const jobId = ((await h.post(heartBody)).json as { jobId: string }).jobId;
    const res = await h.get(jobId);
    expect(res.json).toEqual({ jobId, status: 'running' });
    expect(OldRunningSchema.safeParse(res.json).success).toBe(true);
    gate.release();
  });

  it('sends no counts for a single-step stage, and none once the job has ended', async () => {
    const gate = deferred();
    const h = await startHarness({ runPipeline: reportingPipeline([{ stage: 'assembling' }], gate) });
    const jobId = ((await h.post(heartBody)).json as { jobId: string }).jobId;
    const running = await h.request(`/jobs/${jobId}?progress=1`, { headers: { 'X-Session-Token': TOKEN } });
    expect(running.json).toEqual({ jobId, status: 'running', progress: { stage: 'assembling' } });
    gate.release();
    const done = await h.waitDone(jobId);
    expect((done.json as Record<string, unknown>)['progress']).toBeUndefined();
  });

  it('carries stage names and counts only, and rejects counts that do not add up', () => {
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'running', progress: { stage: 'reviewing', done: 3, total: 2 } }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'running', progress: { stage: 'reviewing', done: 1 } }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'running', progress: { stage: 'thinking' } }).success).toBe(false);
    expect(JobStatusResponseSchema.safeParse({ jobId: 'j', status: 'running', progress: { stage: 'extracting', note: 'x' } }).success).toBe(false);
  });
});
