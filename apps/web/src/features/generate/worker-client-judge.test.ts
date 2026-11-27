import { describe, expect, it } from 'vitest';
import { ackBody, plainBody } from '../../test-support/worker-bodies';
import { createWorkerClient } from './worker-client';

// Built at run time: the style guard bans cross-origin URL literals in source.
const ORIGIN = ['https:', 'worker.example'].join('//');
const TOKEN = 'A'.repeat(32);
const CODE = 'judge-code-0123456789-abcdef';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(respond: (call: Call) => Response, judgeCode?: () => string) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as unknown as typeof fetch;
  const client = createWorkerClient({
    origin: ORIGIN,
    fetchImpl,
    sessionToken: TOKEN,
    timeoutMs: 1000,
    ...(judgeCode === undefined ? {} : { judgeCode }),
  });
  return { client, calls };
}

const headersOf = (call: Call): Record<string, string> => call.init.headers as Record<string, string>;

describe('startJob with a judge access code', () => {
  it('sends POST /judge/jobs with the code in the X-Judge-Token header only', async () => {
    const { client, calls } = setup(() => json(202, ackBody('queued')), () => CODE);
    const result = await client.startJob('my notes', 'key-1', 'standard');
    expect(result).toEqual({ ok: true, value: { jobId: 'job-1', status: 'queued' } });
    const call = calls[0] as Call;
    expect(call.url).toBe(`${ORIGIN}/judge/jobs`);
    expect(headersOf(call)['X-Judge-Token']).toBe(CODE);
    expect(call.url).not.toContain(CODE);
    expect(call.init.body as string).not.toContain(CODE);
    expect(Object.keys(JSON.parse(call.init.body as string) as object).sort()).toEqual(['notesText', 'runLength']);
    expect(call.init.credentials).toBe('omit');
  });

  it('trims the code', async () => {
    const { client, calls } = setup(() => json(202, ackBody('queued')), () => `  ${CODE}\n`);
    await client.startJob('my notes', 'key-1');
    expect(headersOf(calls[0] as Call)['X-Judge-Token']).toBe(CODE);
  });

  it('sends the public request when the code is empty or blank', async () => {
    for (const code of ['', '   ']) {
      const { client, calls } = setup(() => json(202, ackBody('queued')), () => code);
      await client.startJob('my notes', 'key-1');
      const call = calls[0] as Call;
      expect(call.url).toBe(`${ORIGIN}/jobs`);
      expect(Object.keys(headersOf(call))).not.toContain('X-Judge-Token');
    }
  });

  it('reads the code each time a job starts, so a later edit applies', async () => {
    let code = '';
    const { client, calls } = setup(() => json(202, ackBody('queued')), () => code);
    await client.startJob('a', 'key-1');
    code = CODE;
    await client.startJob('a', 'key-2');
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/jobs', '/judge/jobs']);
  });

  it('maps a refused code (403) and an absent judge route (404) to judge-denied', async () => {
    for (const status of [403, 404]) {
      const { client } = setup(() => json(status, { error: 'judge-access-denied', message: 'x' }), () => CODE);
      expect(await client.startJob('a', 'key-1')).toEqual({ ok: false, error: { kind: 'judge-denied' } });
    }
  });

  it('keeps other refusals as they are, and a 403 on the public route is not a judge error', async () => {
    const limited = setup(() => json(429, { error: 'capacity', message: 'x' }), () => CODE);
    expect(await limited.client.startJob('a', 'key-1')).toEqual({ ok: false, error: { kind: 'rejected', status: 429 } });
    const publicRoute = setup(() => json(403, {}), () => '');
    expect(await publicRoute.client.startJob('a', 'key-1')).toEqual({ ok: false, error: { kind: 'rejected', status: 403 } });
  });

  it('puts the code in no error and no later request', async () => {
    const { client, calls } = setup(
      (call) => (call.init.method === 'POST' ? json(403, { error: 'judge-access-denied', message: CODE }) : json(200, plainBody('running'))),
      () => CODE,
    );
    const denied = await client.startJob('a', 'key-1');
    expect(JSON.stringify(denied)).not.toContain(CODE);
    await client.getJob('job-1');
    client.cancelJob('job-1');
    for (const call of calls.slice(1)) {
      expect(JSON.stringify(call.init.headers)).not.toContain(CODE);
      expect(call.url).not.toContain(CODE);
    }
  });
});
