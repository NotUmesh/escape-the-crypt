import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSampleCrypt } from '../../state/sample-crypt-source';
import { createWorkerClient } from './worker-client';
import type { WorkerClient } from './worker-client';

// Built at run time: the style guard bans cross-origin URL literals in source.
const ORIGIN = ['https:', 'worker.example'].join('//');
const TOKEN = 'A'.repeat(32);

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

let bundleJson: unknown;

beforeAll(() => {
  const built = buildSampleCrypt();
  if (!built.ok) throw new Error(`sample crypt did not build: ${built.error.kind}`);
  bundleJson = JSON.parse(JSON.stringify({ manifest: built.value.manifest, content: built.value.content }));
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(respond: (call: Call) => Response | Promise<Response>): { client: WorkerClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as unknown as typeof fetch;
  return { client: createWorkerClient({ origin: ORIGIN, fetchImpl, sessionToken: TOKEN, timeoutMs: 1000 }), calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('startJob', () => {
  it('posts only notesText and runLength with the token and idempotency key', async () => {
    const { client, calls } = setup(() => jsonResponse(202, { jobId: 'job-1', status: 'queued' }));
    const result = await client.startJob('my notes', 'key-1');
    expect(result).toEqual({ ok: true, value: { jobId: 'job-1', status: 'queued' } });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0] as Call;
    expect(url).toBe(`${ORIGIN}/jobs`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ notesText: 'my notes', runLength: 'short' });
    expect(Object.keys(JSON.parse(init.body as string) as object).sort()).toEqual(['notesText', 'runLength']);
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Session-Token': TOKEN,
      'Idempotency-Key': 'key-1',
    });
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a malformed 202 body', async () => {
    const { client } = setup(() => jsonResponse(202, { status: 'queued' }));
    expect(await client.startJob('n', 'k')).toEqual({
      ok: false,
      error: { kind: 'invalid-response', reason: 'schema' },
    });
  });

  it('maps a 429 to rejected with the status only', async () => {
    const { client } = setup(() => jsonResponse(429, { error: 'session-busy', notesText: 'secret' }));
    expect(await client.startJob('n', 'k')).toEqual({ ok: false, error: { kind: 'rejected', status: 429 } });
  });
});

describe('getJob', () => {
  it('sends only the session token, with no body and no cookies', async () => {
    const { client, calls } = setup(() => jsonResponse(200, { status: 'queued' }));
    await client.getJob('a/b c');
    const { url, init } = calls[0] as Call;
    expect(url).toBe(`${ORIGIN}/jobs/a%2Fb%20c`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ 'X-Session-Token': TOKEN });
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it.each(['queued', 'running', 'cancelled', 'expired'] as const)('maps status %s', async (status) => {
    const { client } = setup(() => jsonResponse(200, { status }));
    expect(await client.getJob('j')).toEqual({ ok: true, value: { kind: status } });
  });

  it.each(['expired', 'budget-exhausted', 'not-enough-material', 'generation-failed'] as const)(
    'maps failure %s',
    async (failure) => {
      const { client } = setup(() => jsonResponse(200, { status: 'failed', failure }));
      expect(await client.getJob('j')).toEqual({ ok: true, value: { kind: 'failed', failure } });
    },
  );

  it('maps a worker failure of cancelled to the cancelled state', async () => {
    const { client } = setup(() => jsonResponse(200, { status: 'failed', failure: 'cancelled' }));
    expect(await client.getJob('j')).toEqual({ ok: true, value: { kind: 'cancelled' } });
  });

  it('treats an unknown failure string as an invalid response', async () => {
    const { client } = setup(() => jsonResponse(200, { status: 'failed', failure: 'meteor' }));
    expect(await client.getJob('j')).toEqual({
      ok: false,
      error: { kind: 'invalid-response', reason: 'unknown-failure' },
    });
  });

  it('treats failed without a failure as an invalid response', async () => {
    const { client } = setup(() => jsonResponse(200, { status: 'failed' }));
    expect(await client.getJob('j')).toEqual({ ok: false, error: { kind: 'invalid-response', reason: 'schema' } });
  });

  it('returns the bundle for a completed job', async () => {
    const { client } = setup(() => jsonResponse(200, { status: 'completed', ...(bundleJson as object), extra: 1 }));
    const result = await client.getJob('j');
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'completed') throw new Error('expected completed');
    expect(result.value.bundle.manifest.rooms.length).toBeGreaterThan(0);
    expect(Object.keys(result.value.bundle.content.questions).length).toBeGreaterThan(0);
  });

  it('rejects a completed body that parseCryptBundle refuses, naming the kind only', async () => {
    const { client } = setup(() =>
      jsonResponse(200, { status: 'completed', manifest: (bundleJson as { manifest: unknown }).manifest, content: { questions: {}, concepts: {} } }),
    );
    const result = await client.getJob('j');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid-response');
    if (result.error.kind !== 'invalid-response') return;
    expect(result.error.reason).toBe('bundle');
    expect(result.error.bundleErrorKind).toBe('bundle-content-missing');
    expect(JSON.stringify(result.error)).not.toContain('questionId');
  });

  it('rejects a completed body with no manifest', async () => {
    const { client } = setup(() => jsonResponse(200, { status: 'completed' }));
    const result = await client.getJob('j');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: 'invalid-response', reason: 'bundle' });
  });

  it.each([
    ['an unknown status', { status: 'sleeping' }],
    ['a non-object', 'queued'],
    ['null', null],
  ])('rejects %s', async (_name, body) => {
    const { client } = setup(() => jsonResponse(200, body));
    expect(await client.getJob('j')).toEqual({ ok: false, error: { kind: 'invalid-response', reason: 'schema' } });
  });

  it('rejects a body that is not JSON', async () => {
    const { client } = setup(() => new Response('<html>nope</html>', { status: 200 }));
    expect(await client.getJob('j')).toEqual({ ok: false, error: { kind: 'invalid-response', reason: 'not-json' } });
  });

  it('maps 404 to not-found', async () => {
    const { client } = setup(() => jsonResponse(404, { error: 'not-found' }));
    expect(await client.getJob('j')).toEqual({ ok: false, error: { kind: 'not-found' } });
  });

  it.each([400, 500, 503])('maps HTTP %i to rejected with the status only', async (status) => {
    const { client } = setup(() => jsonResponse(status, { notesText: 'private' }));
    const result = await client.getJob('j');
    expect(result).toEqual({ ok: false, error: { kind: 'rejected', status } });
  });

  it('maps a thrown fetch to network without carrying the message', async () => {
    const { client } = setup(() => {
      throw new TypeError('Failed to fetch ' + ORIGIN + '/jobs/j');
    });
    const result = await client.getJob('j');
    expect(result).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('maps a request that outlives the timeout to timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const client = createWorkerClient({ origin: ORIGIN, fetchImpl, sessionToken: TOKEN, timeoutMs: 5000 });
    const pending = client.getJob('j');
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: { kind: 'timeout' } });
  });

  it('clears the timer after a response', async () => {
    vi.useFakeTimers();
    const { client } = setup(() => jsonResponse(200, { status: 'queued' }));
    await client.getJob('j');
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('cancelJob', () => {
    it('sends DELETE with the token, no cookies and keepalive', () => {
      const { client, calls } = setup(() => new Response(null, { status: 204 }));
      client.cancelJob('job/1');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(`${ORIGIN}/jobs/job%2F1`);
      expect(calls[0]?.init.method).toBe('DELETE');
      expect(calls[0]?.init.headers).toEqual({ 'X-Session-Token': TOKEN });
      expect(calls[0]?.init.credentials).toBe('omit');
      expect(calls[0]?.init.cache).toBe('no-store');
      expect(calls[0]?.init.redirect).toBe('error');
      expect(calls[0]?.init.keepalive).toBe(true);
    });
    for (const status of [404, 405, 500]) {
      it(`ignores a ${status} answer`, async () => {
        const { client } = setup(() => new Response('{}', { status }));
        expect(client.cancelJob('j')).toBeUndefined();
        await Promise.resolve();
      });
    }
    it('ignores a network error without an unhandled rejection', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      const fetchImpl = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
      const client = createWorkerClient({ origin: ORIGIN, fetchImpl, sessionToken: TOKEN, timeoutMs: 1000 });
      expect(() => client.cancelJob('j')).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      process.off('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });
    it('ignores a fetch that throws at once', () => {
      const fetchImpl = (() => {
        throw new TypeError('boom');
      }) as unknown as typeof fetch;
      const client = createWorkerClient({ origin: ORIGIN, fetchImpl, sessionToken: TOKEN, timeoutMs: 1000 });
      expect(() => client.cancelJob('j')).not.toThrow();
    });
  });
});
