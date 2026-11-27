import { afterEach, describe, expect, it } from 'vitest';
import {
  HEART_NOTES,
  KEY,
  KEY_2,
  TOKEN,
  TOKEN_B,
  closeAll,
  failingPipeline,
  heartBody,
  stableHeaders,
  startHarness,
} from './http-test-support';

afterEach(closeAll);

const NO_STORE = 'private, no-store';
const idOf = (r: { json: unknown }): string => (r.json as { jobId: string }).jobId;

describe('POST /jobs → GET /jobs/:id', () => {
  it('runs the real pipeline over the cassette and returns a bundle without metadata', async () => {
    const h = await startHarness();
    const created = await h.post(heartBody);
    expect(created.status).toBe(202);
    expect(created.headers.get('cache-control')).toBe(NO_STORE);
    expect(created.json).toMatchObject({ status: 'queued' });

    const done = await h.waitDone(idOf(created));
    expect(done.status).toBe(200);
    expect(done.headers.get('cache-control')).toBe(NO_STORE);
    const body = done.json as { status: string; bundle: { manifest: { rooms: { lockSlots: unknown[] }[] } } };
    expect(body.status).toBe('completed');
    expect(body.bundle.manifest.rooms).toHaveLength(1);
    expect(body.bundle.manifest.rooms[0]?.lockSlots).toHaveLength(2);
    expect(Object.keys(body.bundle).sort()).toEqual(['content', 'manifest', 'unplacedAccepted']);
    expect(done.text).not.toContain('"metadata"');
    expect(h.runs()).toBe(1);
    expect(h.ledger.reservations).toBeGreaterThan(0);
  });

  it('replays the same request without a second run', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    const first = await h.post(heartBody);
    const again = await h.post(heartBody);
    expect(again.status).toBe(200);
    expect(idOf(again)).toBe(idOf(first));
    expect(h.runs()).toBe(1);
  });

  it('answers 409 for the same key with a different body, with no new work', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    await h.post(heartBody);
    const res = await h.post({ notesText: 'Other notes about something else entirely.', runLength: 'short' });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ error: 'idempotency-conflict' });
    expect(h.runs()).toBe(1);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
  });
});

describe('request validation', () => {
  it.each([
    ['missing', undefined],
    ['too short', 'short-token'],
    ['bad characters', 'tok!tok!tok!tok!tok!tok!tok'],
    ['too long', 'a'.repeat(129)],
  ])('rejects a %s session token with a typed 400', async (_name, token) => {
    const h = await startHarness();
    const headers: Record<string, string> = { 'Idempotency-Key': KEY, 'Content-Type': 'application/json' };
    if (token !== undefined) headers['X-Session-Token'] = token;
    const res = await h.request('/jobs', { method: 'POST', headers, body: JSON.stringify(heartBody) });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'invalid-session-token' });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(0);
    expect(h.ledger.reservations).toBe(0);
  });

  it('rejects a malformed token on GET', async () => {
    const h = await startHarness();
    const res = await h.get('anything', 'short');
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'invalid-session-token' });
  });

  it.each([['missing', undefined], ['short', 'abc'], ['bad chars', 'key with spaces!']])(
    'rejects a %s idempotency key',
    async (_name, key) => {
      const h = await startHarness();
      const headers: Record<string, string> = { 'X-Session-Token': TOKEN };
      if (key !== undefined) headers['Idempotency-Key'] = key;
      const res = await h.request('/jobs', { method: 'POST', headers, body: JSON.stringify(heartBody) });
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ error: 'invalid-idempotency-key' });
    },
  );

  it.each([
    ['invalid JSON', '{nope', 'invalid-json'],
    ['extra field', JSON.stringify({ ...heartBody, extra: 1 }), 'invalid-body'],
    ['unknown run length', JSON.stringify({ notesText: 'x y z', runLength: 'epic' }), 'invalid-body'],
    ['blank notes', JSON.stringify({ notesText: '   ', runLength: 'short' }), 'invalid-body'],
  ])('rejects %s with 400 before any work', async (_name, body, kind) => {
    const h = await startHarness();
    const res = await h.post(body);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: kind });
    expect(h.runs()).toBe(0);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
  });
});

describe('not found, expiry and replay', () => {
  it('answers a wrong session exactly like a missing job', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }) });
    const created = await h.post(heartBody);
    await h.waitDone(idOf(created));
    const wrong = await h.get(idOf(created), TOKEN_B);
    const missing = await h.get('no-such-job', TOKEN);
    expect(wrong.status).toBe(404);
    expect(wrong.status).toBe(missing.status);
    expect(wrong.text).toBe(missing.text);
    expect(stableHeaders(wrong.headers)).toEqual(stableHeaders(missing.headers));
    expect(wrong.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('answers 404 for an unknown route', async () => {
    const h = await startHarness();
    const res = await h.request('/nope');
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ error: 'not-found' });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('serves /health', async () => {
    const h = await startHarness();
    const res = await h.request('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('answers expired for the right session after the TTL, and 404 for the wrong one', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }), jobTtlMs: 1000 });
    const created = await h.post(heartBody);
    await h.waitDone(idOf(created));
    h.clock.t += 2000;
    h.store.sweepExpired();
    const res = await h.get(idOf(created));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ jobId: idOf(created), status: 'expired' });
    expect(res.headers.get('cache-control')).toBe(NO_STORE);
    expect((await h.get(idOf(created), TOKEN_B)).status).toBe(404);
  });

  it('answers a repeated POST after the TTL with expired and no new work', async () => {
    const h = await startHarness({ runPipeline: failingPipeline({ kind: 'empty-room' }), jobTtlMs: 1000 });
    const created = await h.post(heartBody);
    await h.waitDone(idOf(created));
    h.clock.t += 2000;
    h.store.sweepExpired();
    const again = await h.post(heartBody);
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ jobId: idOf(created), status: 'expired' });
    expect(again.headers.get('cache-control')).toBe(NO_STORE);
    expect(h.runs()).toBe(1);
    expect(h.ledger.reservations).toBe(0);
    expect(h.provider.calls).toBe(0);
  });
});

describe('failure bodies', () => {
  it.each([
    ['budget-exhausted', { kind: 'budget-exhausted' as const }],
    ['not-enough-material', { kind: 'empty-room' as const }],
    ['not-enough-material', { kind: 'input-too-long' as const, limit: 6000 }],
    ['generation-failed', { kind: 'provider-failed' as const, stage: 'generation' as const, retryable: false }],
    ['generation-failed', { kind: 'schema-not-representable' as const, stage: 'review' as const }],
  ])('maps a pipeline error to %s', async (kind, error) => {
    const h = await startHarness({ runPipeline: failingPipeline(error) });
    const created = await h.post(heartBody);
    const done = await h.waitDone(idOf(created));
    expect(done.status).toBe(200);
    expect(done.headers.get('cache-control')).toBe(NO_STORE);
    const body = done.json as { status: string; failure: { kind: string; message: string } };
    expect(body.status).toBe('failed');
    expect(body.failure.kind).toBe(kind);
    expect(body.failure.message.length).toBeGreaterThan(10);
    expect(Object.keys(body.failure).sort()).toEqual(['kind', 'message']);
  });

  it('turns an unexpected throw into generation-failed and keeps serving', async () => {
    const h = await startHarness({
      runPipeline: () => {
        throw new Error(`boom ${HEART_NOTES.slice(0, 40)}`);
      },
    });
    const created = await h.post(heartBody);
    const done = await h.waitDone(idOf(created));
    expect(done.json).toMatchObject({ status: 'failed', failure: { kind: 'generation-failed' } });
    expect((await h.request('/health')).status).toBe(200);
    expect(JSON.stringify(h.logs)).not.toContain('boom');
  });
});

describe('logging', () => {
  it('records no notes text, token, idempotency key or job ID', async () => {
    const h = await startHarness();
    const created = await h.post(heartBody, { 'Idempotency-Key': KEY_2 });
    const id = idOf(created);
    await h.waitDone(id);
    await h.get(id, TOKEN_B);
    const logged = JSON.stringify(h.logs);
    expect(h.logs.length).toBeGreaterThan(0);
    for (const secret of [TOKEN, TOKEN_B, KEY_2, id, ...HEART_NOTES.split(/(?<=\.)\s+/).filter((s) => s.length > 20)]) {
      expect(logged).not.toContain(secret);
    }
  });
});
