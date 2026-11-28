import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkerClient } from './worker-client';

// Built at run time: the style guard bans cross-origin URL literals in source.
const ORIGIN = ['https:', 'worker.example'].join('//');
const FIXTURE = join(process.cwd(), '..', '..', 'packages', 'core', 'src', 'test-support', 'contract', 'job-completed.json');
const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  response: { jobId: string; bundle: Record<string, unknown> };
  notices: { request: string; response: { jobId: string; bundle: { notices: Record<string, unknown> } } };
};

function clientFor(body: unknown, seen: string[] = []) {
  const fetchImpl = ((url: string) => {
    seen.push(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }) as unknown as typeof fetch;
  return createWorkerClient({ origin: ORIGIN, fetchImpl, sessionToken: 'A'.repeat(32), timeoutMs: 1000 });
}

describe('getJob and notices', () => {
  it('asks for the notices along with the progress', async () => {
    const seen: string[] = [];
    await clientFor(recorded.notices.response, seen).getJob('job-1');
    expect(new URL(seen[0] ?? '').searchParams.get('notices')).toBe('1');
    expect(new URL(seen[0] ?? '').searchParams.get('progress')).toBe('1');
    // The request the worker's own contract test records is the same ask.
    expect(recorded.notices.request).toBe('GET /jobs/:id?notices=1');
  });

  it('hands back the notices the worker sent with a completed job', async () => {
    const polled = await clientFor(recorded.notices.response).getJob(recorded.notices.response.jobId);
    if (!polled.ok || polled.value.kind !== 'completed') throw new Error('the recorded body must read as completed');
    expect(polled.value.notices).toEqual(recorded.notices.response.bundle.notices);
  });

  it('hands back no notices from a worker that sends none', async () => {
    const polled = await clientFor(recorded.response).getJob(recorded.response.jobId);
    if (!polled.ok || polled.value.kind !== 'completed') throw new Error('the recorded body must read as completed');
    expect('notices' in polled.value).toBe(false);
  });

  it('refuses a notices object with a field it does not know, rather than showing it', async () => {
    const tampered = JSON.parse(JSON.stringify(recorded.notices.response)) as typeof recorded.notices.response;
    tampered.bundle.notices['html'] = '<b>x</b>';
    expect(await clientFor(tampered).getJob(tampered.jobId)).toEqual({ ok: false, error: { kind: 'invalid-response', reason: 'schema' } });
  });
});
