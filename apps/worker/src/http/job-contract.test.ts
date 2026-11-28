import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JobAckResponseSchema,
  JobErrorResponseSchema,
  JobStatusResponseSchema,
  parseCryptBundle,
  runRoomPipeline,
  type PipelineResult,
} from '@escape-the-crypt/core';
import { makeDeferredScriptedProvider } from './deferred-provider-test-support';
import type { RunPipeline } from './job-runner';
import {
  HEART_NOTES,
  HEART_SETTINGS,
  KEY,
  KEY_2,
  TOKEN,
  TOKEN_B,
  closeAll,
  deferred,
  failingPipeline,
  heartBody,
  heartExtractionJson,
  reportingPipeline,
  startHarness,
  type Harness,
  type HttpResult,
} from './http-test-support';

afterEach(closeAll);

/**
 * Golden contract fixture, read by the web's contract test. To regenerate it after an
 * intended change to the worker's output:
 *   UPDATE_CONTRACT=1 pnpm --filter ./apps/worker exec vitest --run job-contract
 * Review the diff before committing. Without the flag, any difference fails the test.
 */
const FIXTURE_PATH = fileURLToPath(
  new URL('../../../../packages/core/src/test-support/contract/job-completed.json', import.meta.url),
);
/** The job id is random per run; the fixture pins this value instead. */
const FIXTURE_JOB_ID = 'job-contract-1';

type PipelineNotices = NonNullable<PipelineResult['notices']>;

/**
 * The notice the real pipeline produced for adv-18 (27 days in paragraph 4, 35 days in paragraph 7
 * of eval/adversarial/notes/adv-01-moon.txt). Chunk IDs are the code-assigned IDs of that notes text.
 */
const ADV18_NOTICES: PipelineNotices = {
  excluded: [
    {
      conceptId: 'concept-1',
      conceptTitle: 'Time for the Moon to orbit Earth',
      source: 'model',
      passages: [
        { chunkId: 'chk_21c60b15f118_3', quote: 'The Moon takes about 27 days to orbit Earth.' },
        { chunkId: 'chk_21c60b15f118_6', quote: 'One orbit of the Moon around Earth takes about 35 days.' },
      ],
    },
  ],
  sufficiency: null,
};

/** Runs the recorded heart pipeline, then attaches the notices. */
function withNotices(notices: PipelineNotices): RunPipeline {
  return async (notes, options) => {
    const result = await runRoomPipeline(notes, options);
    return result.ok ? { ok: true, value: { ...result.value, notices } } : result;
  };
}

const idOf = (r: HttpResult): string => (r.json as { jobId: string }).jobId;

function parseStatus(r: HttpResult) {
  const parsed = JobStatusResponseSchema.safeParse(r.json);
  expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues.map((i) => i.path))).toBe(true);
  return parsed.success ? parsed.data : null;
}
function parseAck(r: HttpResult) {
  const parsed = JobAckResponseSchema.safeParse(r.json);
  expect(parsed.success).toBe(true);
  return parsed.success ? parsed.data : null;
}
function parseError(r: HttpResult, status: number, kind: string): void {
  expect(r.status).toBe(status);
  const parsed = JobErrorResponseSchema.safeParse(r.json);
  expect(parsed.success).toBe(true);
  expect(parsed.success && parsed.data.error).toBe(kind);
}
const del = (h: Harness, jobId: string, token = TOKEN): Promise<HttpResult> =>
  h.request(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: { 'X-Session-Token': token } });

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
}

describe('completed job (real pipeline over the recorded cassette)', () => {
  it('serialises a body that parses with JobStatusResponseSchema and matches the golden fixture', async () => {
    const h = await startHarness();
    const created = await h.post(heartBody);
    expect(created.status).toBe(202);
    expect(parseAck(created)?.status).toBe('queued');
    const done = await h.waitDone(idOf(created));
    const body = parseStatus(done);
    expect(body?.status).toBe('completed');
    if (body?.status !== 'completed') return;
    // The web's deeper gate accepts the same bundle.
    expect(parseCryptBundle(body.bundle).ok).toBe(true);

    // Contract version 2 (deliberate): a running job reports its stage and real counts to a client
    // that asks with ?progress=1. Recorded from the real server so the web's test reads real output.
    const gate = deferred();
    const progressing = await startHarness({
      runPipeline: reportingPipeline([{ stage: 'extracting' }, { stage: 'generating', done: 2, total: 6 }], gate),
    });
    const runningId = idOf(await progressing.post(heartBody));
    const runningRes = await progressing.request(`/jobs/${runningId}?progress=1`, { headers: { 'X-Session-Token': TOKEN } });
    const running = parseStatus(runningRes);
    gate.release();
    expect(running?.status).toBe('running');
    // Task 44.20 (additive, contractVersion stays 2): the same completed job read with ?notices=1,
    // carrying the real adv-18 notice. The chunk IDs and quotes are the output of the real
    // conflict pipeline (core's captureConflictE2e over eval/adversarial/notes/adv-01-moon.txt).
    const noticed = await startHarness({ runPipeline: withNotices(ADV18_NOTICES) });
    const noticedId = idOf(await noticed.post(heartBody));
    await noticed.waitDone(noticedId);
    const noticedRes = await noticed.request(`/jobs/${noticedId}?notices=1`, { headers: { 'X-Session-Token': TOKEN } });
    const withNoticesBody = parseStatus(noticedRes);
    expect(withNoticesBody?.status).toBe('completed');
    if (withNoticesBody?.status !== 'completed') return;
    expect(parseCryptBundle(withNoticesBody.bundle).ok).toBe(true);
    expect(withNoticesBody.bundle.notices).toEqual(ADV18_NOTICES);
    const golden = {
      contractVersion: 2,
      notesText: HEART_NOTES,
      response: { ...body, jobId: FIXTURE_JOB_ID },
      running: { request: 'GET /jobs/:id?progress=1', response: { ...running, jobId: FIXTURE_JOB_ID } },
      notices: { request: 'GET /jobs/:id?notices=1', response: { ...withNoticesBody, jobId: FIXTURE_JOB_ID } },
    };
    const text = `${JSON.stringify(golden, null, 2)}\n`;
    if (process.env['UPDATE_CONTRACT'] === '1' || !existsSync(FIXTURE_PATH)) {
      mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
      writeFileSync(FIXTURE_PATH, text, 'utf8');
    }
    const committed = readFileSync(FIXTURE_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(JSON.parse(committed)).toEqual(JSON.parse(text));
  });

  it('answers a replayed POST and a DELETE after completion with a bundle-free ack', async () => {
    const h = await startHarness();
    const first = await h.post(heartBody);
    await h.waitDone(idOf(first));
    const replay = await h.post(heartBody);
    expect(replay.status).toBe(200);
    expect(parseAck(replay)).toEqual({ jobId: idOf(first), status: 'completed' });
    const deleted = await del(h, idOf(first));
    expect(deleted.status).toBe(200);
    expect(parseAck(deleted)?.status).toBe('completed');
    expect(deleted.text).not.toContain('bundle');
  });
});

describe('failed, cancelled and expired jobs', () => {
  it('parses a failed job with a failure object', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    const created = await h.post(heartBody);
    const done = await h.waitDone(idOf(created));
    const body = parseStatus(done);
    expect(body?.status).toBe('failed');
    expect(body?.status === 'failed' && body.failure.kind).toBe('not-enough-material');
  });

  it('parses cancelling and cancelled bodies and the DELETE acks', async () => {
    const scripted = makeDeferredScriptedProvider(heartExtractionJson());
    const h = await startHarness({ provider: scripted, controllers: new Map(), pipelineSettings: HEART_SETTINGS });
    const created = await h.post(heartBody);
    await waitFor(() => scripted.pending === 1);
    const id = idOf(created);
    parseError(await h.post(heartBody, { 'Idempotency-Key': KEY_2 }), 429, 'session-busy');
    const cancel = await del(h, id);
    expect(cancel.status).toBe(202);
    expect(parseAck(cancel)).toEqual({ jobId: id, status: 'cancelling' });
    expect(parseStatus(await h.get(id))?.status).toBe('cancelling');
    scripted.settleAll();
    let last = await h.get(id);
    for (let i = 0; i < 1000 && (last.json as { status: string }).status === 'cancelling'; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      last = await h.get(id);
    }
    const body = parseStatus(last);
    expect(body?.status).toBe('cancelled');
    expect(body?.status === 'cancelled' && body.failure.kind).toBe('cancelled');
    const again = await del(h, id);
    expect(again.status).toBe(200);
    expect(parseAck(again)).toEqual({ jobId: id, status: 'cancelled' });
  });

  it('parses expired bodies from GET, POST replay and DELETE', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }), jobTtlMs: 1000 });
    const created = await h.post(heartBody);
    const id = idOf(created);
    await h.waitDone(id);
    h.clock.t += 2000;
    h.store.sweepExpired();
    expect(parseStatus(await h.get(id))?.status).toBe('expired');
    const replay = await h.post(heartBody);
    expect(replay.status).toBe(200);
    expect(parseAck(replay)).toEqual({ jobId: id, status: 'expired' });
    const deleted = await del(h, id);
    expect(parseAck(deleted)).toEqual({ jobId: id, status: 'expired' });
  });
});

describe('error bodies', () => {
  it('parses every sendError body the routes produce', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    const noToken = await h.request('/jobs', { method: 'POST', headers: { 'Idempotency-Key': KEY }, body: '{}' });
    parseError(noToken, 400, 'invalid-session-token');
    parseError(await h.post(heartBody, { 'Idempotency-Key': 'x' }), 400, 'invalid-idempotency-key');
    parseError(await h.post('{nope'), 400, 'invalid-json');
    parseError(await h.post({ notesText: '', runLength: 'short' }), 400, 'invalid-body');
    const created = await h.post(heartBody);
    expect(created.status).toBe(202);
    parseError(await h.post({ notesText: 'Other notes.', runLength: 'short' }), 409, 'idempotency-conflict');
    await h.waitDone(idOf(created));
    parseError(await h.get(idOf(created), TOKEN_B), 404, 'not-found');
    parseError(await h.get('missing-job'), 404, 'not-found');
    parseError(await del(h, 'missing-job'), 404, 'not-found');
  });
});
