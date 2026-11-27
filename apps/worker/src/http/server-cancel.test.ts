import { afterEach, describe, expect, it } from 'vitest';
import { TOMBSTONE_TTL_MS } from '../jobs/job-store';
import { makeDeferredScriptedProvider, type DeferredScriptedProvider } from './deferred-provider-test-support';
import {
  HEART_NOTES,
  HEART_SETTINGS,
  KEY,
  KEY_2,
  TOKEN,
  TOKEN_B,
  WEB_ORIGIN,
  closeAll,
  failingPipeline,
  heartBody,
  heartExtractionJson,
  stableHeaders,
  startHarness,
  type Harness,
} from './http-test-support';

afterEach(closeAll);

const NO_STORE = 'private, no-store';
const idOf = (r: { json: unknown }): string => (r.json as { jobId: string }).jobId;
const statusOf = (r: { json: unknown }): string | undefined => (r.json as { status?: string } | null)?.status;

/** Bounded polling, no fixed sleeps: gives up after about five seconds. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function waitStatus(h: Harness, jobId: string, status: string): Promise<Awaited<ReturnType<Harness['get']>>> {
  for (let i = 0; i < 1000; i += 1) {
    const res = await h.get(jobId);
    if (statusOf(res) === status) return res;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job never reached ${status}`);
}

/** Every DELETE response must carry `Cache-Control: private, no-store`, so the helper checks it. */
async function del(h: Harness, jobId: string, token: string | null = TOKEN) {
  const res = await h.request(`/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: token === null ? {} : { 'X-Session-Token': token },
  });
  expect(res.headers.get('cache-control')).toBe(NO_STORE);
  return res;
}

interface Running {
  readonly h: Harness;
  readonly scripted: DeferredScriptedProvider;
  readonly controllers: Map<string, AbortController>;
}

async function startDeferred(concurrency = 1): Promise<Running> {
  const scripted = makeDeferredScriptedProvider(heartExtractionJson());
  const controllers = new Map<string, AbortController>();
  const h = await startHarness({
    provider: scripted,
    controllers,
    pipelineSettings: { ...HEART_SETTINGS, concurrency },
  });
  return { h, scripted, controllers };
}

/** POSTs a job and waits until its extraction call is in flight. */
async function startRunning(r: Running, key = KEY): Promise<string> {
  const created = await r.h.post(heartBody, { 'Idempotency-Key': key });
  expect(created.status).toBe(202);
  await waitFor(() => r.scripted.pending === 1, 'the extraction call');
  expect(r.scripted.started).toEqual(['concept-extraction']);
  return idOf(created);
}

const ledgerSettled = (h: Harness): void => {
  expect(h.ledger.reservations).toBeGreaterThan(0);
  expect(h.ledger.reservations).toBe(h.ledger.reconciles + h.ledger.releases);
  expect(h.ledger.outstandingMicroUsd).toBe(0);
};

describe('DELETE /jobs/:id on a running job', () => {
  it('cancels mid-flight: no new calls, ledger settled, final GET is cancelled', async () => {
    const r = await startDeferred();
    const id = await startRunning(r);

    const cancel = await del(r.h, id);
    expect(cancel.status).toBe(202);
    expect(cancel.json).toEqual({ jobId: id, status: 'cancelling' });
    expect(r.controllers.get(id)?.signal.aborted).toBe(true);

    const during = await r.h.get(id);
    expect(during.status).toBe(200);
    expect(during.json).toEqual({ jobId: id, status: 'cancelling' });

    // The session is still busy while the job is cancelling.
    const busy = await r.h.post(heartBody, { 'Idempotency-Key': KEY_2 });
    expect(busy.status).toBe(429);
    expect(busy.json).toMatchObject({ error: 'session-busy' });

    const callsBefore = r.h.provider.calls;
    expect(r.scripted.settleAll()).toBe(1);
    const done = await waitStatus(r.h, id, 'cancelled');
    expect(done.json).toMatchObject({ jobId: id, status: 'cancelled', failure: { kind: 'cancelled' } });
    expect(done.text).not.toContain('"bundle"');
    expect(r.h.provider.calls).toBe(callsBefore);
    expect(r.scripted.started).toEqual(['concept-extraction']);
    ledgerSettled(r.h);
    await waitFor(() => r.controllers.size === 0, 'the controller to be released');

    // The session is free again.
    const again = await r.h.post(heartBody, { 'Idempotency-Key': KEY_2 });
    expect(again.status).toBe(202);
    const second = idOf(again);
    await waitFor(() => r.scripted.pending === 1, 'the second extraction call');
    expect((await del(r.h, second)).status).toBe(202);
    r.scripted.settleAll();
    await waitStatus(r.h, second, 'cancelled');
    ledgerSettled(r.h);
  });

  it('cancels during generation: every in-flight call reconciles and no review starts', async () => {
    const r = await startDeferred(3);
    const id = await startRunning(r);
    expect(r.scripted.settleNext()).toBe(true);
    await waitFor(() => r.scripted.pending === 3, 'three generation calls in flight');
    expect(r.scripted.started.slice(1)).toEqual(['generation', 'generation', 'generation']);

    expect((await del(r.h, id)).status).toBe(202);
    const callsBefore = r.h.provider.calls;
    expect(r.scripted.settleAll()).toBe(3);
    await waitStatus(r.h, id, 'cancelled');

    expect(r.h.provider.calls).toBe(callsBefore);
    expect(r.scripted.started).not.toContain('review');
    expect(r.h.ledger.reconciles).toBe(4);
    expect(r.h.ledger.releases).toBe(0);
    ledgerSettled(r.h);
    await waitFor(() => r.controllers.size === 0, 'the controller to be released');
  });

  it('answers 202 again for a second DELETE while cancelling', async () => {
    const r = await startDeferred();
    const id = await startRunning(r);
    const first = await del(r.h, id);
    const second = await del(r.h, id);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.json).toEqual({ jobId: id, status: 'cancelling' });
    r.scripted.settleAll();
    await waitStatus(r.h, id, 'cancelled');
    ledgerSettled(r.h);
  });

  it('logs the cancel request without any ID, token, key or notes sentence', async () => {
    const r = await startDeferred();
    const id = await startRunning(r);
    await del(r.h, id);
    await del(r.h, id, TOKEN_B);
    r.scripted.settleAll();
    await waitStatus(r.h, id, 'cancelled');

    const logged = JSON.stringify(r.h.logs);
    expect(r.h.logs.some((l) => l.event === 'job-cancel-requested')).toBe(true);
    const sentences = HEART_NOTES.split(/(?<=\.)\s+/).filter((s) => s.length > 20);
    expect(sentences.length).toBeGreaterThan(0);
    for (const secret of [id, TOKEN, TOKEN_B, KEY, KEY_2, ...sentences]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('answers a wrong session exactly like a missing job, and does not cancel', async () => {
    const r = await startDeferred();
    const id = await startRunning(r);
    const wrong = await del(r.h, id, TOKEN_B);
    const missing = await del(r.h, 'no-such-job');
    expect(wrong.status).toBe(404);
    expect(wrong.status).toBe(missing.status);
    expect(wrong.text).toBe(missing.text);
    expect(stableHeaders(wrong.headers)).toEqual(stableHeaders(missing.headers));
    expect(r.controllers.get(id)?.signal.aborted).toBe(false);
    expect(statusOf(await r.h.get(id))).toBe('running');
    await del(r.h, id);
    r.scripted.settleAll();
    await waitStatus(r.h, id, 'cancelled');
  });
});

describe('DELETE /jobs/:id on finished, expired and unknown jobs', () => {
  it('answers 200 for a completed job and keeps its bundle', async () => {
    const controllers = new Map<string, AbortController>();
    const h = await startHarness({ controllers });
    const id = idOf(await h.post(heartBody));
    expect(statusOf(await h.waitDone(id))).toBe('completed');
    const res = await del(h, id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ jobId: id, status: 'completed' });
    const after = await h.get(id);
    expect(statusOf(after)).toBe('completed');
    expect(after.json).toHaveProperty('bundle');
    await waitFor(() => controllers.size === 0, 'the controller to be released');
  });

  it('answers 200 for a failed job and keeps its failure', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    const id = idOf(await h.post(heartBody));
    await h.waitDone(id);
    const res = await del(h, id);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ jobId: id, status: 'failed' });
    expect((await h.get(id)).json).toMatchObject({ status: 'failed', failure: { kind: 'not-enough-material' } });
  });

  it('answers 200 expired for the right session, 404 for the wrong one and after the tombstone is swept', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }), jobTtlMs: 1000 });
    const id = idOf(await h.post(heartBody));
    await h.waitDone(id);
    h.clock.t += 2000;
    h.store.sweepExpired();
    const expired = await del(h, id);
    expect(expired.status).toBe(200);
    expect(expired.json).toEqual({ jobId: id, status: 'expired' });
    expect((await del(h, id, TOKEN_B)).status).toBe(404);

    h.clock.t += TOMBSTONE_TTL_MS + 1;
    h.store.sweepExpired();
    const swept = await del(h, id);
    const missing = await del(h, 'no-such-job');
    expect(swept.status).toBe(404);
    expect(swept.text).toBe(missing.text);
    expect(stableHeaders(swept.headers)).toEqual(stableHeaders(missing.headers));
  });

  it('answers an overlong ID with the same 404', async () => {
    const h = await startHarness();
    const overlong = await del(h, 'a'.repeat(129));
    const missing = await del(h, 'no-such-job');
    expect(overlong.status).toBe(404);
    expect(overlong.text).toBe(missing.text);
    expect(stableHeaders(overlong.headers)).toEqual(stableHeaders(missing.headers));
  });

  it.each([
    ['missing', null],
    ['too short', 'short'],
    ['bad characters', 'tok!tok!tok!tok!tok!tok!tok'],
  ])('rejects a %s token with the same 400 as GET', async (_name, token) => {
    const h = await startHarness();
    const res = await del(h, 'any-job', token);
    const get = await h.request('/jobs/any-job', { headers: token === null ? {} : { 'X-Session-Token': token } });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'invalid-session-token' });
    expect(res.text).toBe(get.text);
    expect(stableHeaders(res.headers)).toEqual(stableHeaders(get.headers));
  });
});

describe('DELETE support in CORS and resources', () => {
  it('lists DELETE on preflight and never allows credentials', async () => {
    const h = await startHarness();
    const res = await h.request('/jobs/any-job', {
      method: 'OPTIONS',
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'DELETE',
        'Access-Control-Request-Headers': 'x-session-token',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('holds one controller per running job and none afterwards', async () => {
    const r = await startDeferred();
    const id = await startRunning(r);
    expect([...r.controllers.keys()]).toEqual([id]);
    await del(r.h, id);
    r.scripted.settleAll();
    await waitStatus(r.h, id, 'cancelled');
    await waitFor(() => r.controllers.size === 0, 'the controller to be released');
  });
});
