import { afterEach, describe, expect, it } from 'vitest';
import { REQUEST_LIMIT_COPY, renderError } from '@escape-the-crypt/core';
import { ERROR_COPY } from './copy';
import { ALLOWED_HEADERS } from './cors';
import { KEY, KEY_2, TOKEN, closeAll, deferred, gatedPipeline, heartBody, startHarness } from './http-test-support';
import { MAX_ACTIVE_JUDGE_JOBS, MIN_JUDGE_TOKEN_LENGTH, judgeAccessFromEnv } from './judge-access';
import { RATE_LIMIT_MAX_STARTS, RATE_LIMIT_WINDOW_MS, clientAddress, createRateLimiter } from './rate-limit';

afterEach(closeAll);

const JUDGE_CODE = 'judge-code-0123456789-abcdefghij';
const judgePost = (h: Awaited<ReturnType<typeof startHarness>>, extra: Record<string, string> = {}) =>
  h.request('/judge/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': TOKEN, 'Idempotency-Key': KEY, ...extra },
    body: JSON.stringify(heartBody),
  });

describe('per-IP rate limit on POST /jobs', () => {
  it('allows the default number of starts per window, then answers a typed 429 with Retry-After', async () => {
    const gate = deferred();
    const h = await startHarness({ runPipeline: gatedPipeline(gate.promise) });
    for (let i = 0; i < RATE_LIMIT_MAX_STARTS; i += 1) {
      // A new session and key each time, so only the IP limit can refuse.
      const res = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-${i}`, 'Idempotency-Key': `${KEY}-${i}` });
      expect(res.status).toBe(202);
    }
    const over = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-x`, 'Idempotency-Key': `${KEY}-x` });
    expect(over.status).toBe(429);
    expect(over.json).toEqual({ error: 'rate-limited', message: renderError(REQUEST_LIMIT_COPY['rate-limited']) });
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    // Refused before any work: no run, reservation or provider call for it.
    expect(h.runs()).toBe(RATE_LIMIT_MAX_STARTS);
    gate.release();
  });

  it('counts each address separately', async () => {
    const h = await startHarness({ runPipeline: gatedPipeline(deferred().promise), rateLimit: { windowMs: 60_000, maxStarts: 1, maxTrackedIps: 100 } });
    const a = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-a`, 'X-Forwarded-For': '10.0.0.1' });
    const b = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-b`, 'X-Forwarded-For': '10.0.0.2' });
    const a2 = await h.post(heartBody, { 'X-Session-Token': `${TOKEN}-c`, 'X-Forwarded-For': '10.0.0.1', 'Idempotency-Key': KEY_2 });
    expect([a.status, b.status, a2.status]).toEqual([202, 202, 429]);
  });

  it('frees the address once the window passes', () => {
    let t = 0;
    const limiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxStarts: 2, maxTrackedIps: 10 }, () => t);
    expect([limiter.attempt('ip'), limiter.attempt('ip')].every((d) => d.allowed)).toBe(true);
    const refused = limiter.attempt('ip');
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: RATE_LIMIT_WINDOW_MS / 1000 });
    t = RATE_LIMIT_WINDOW_MS;
    expect(limiter.attempt('ip').allowed).toBe(true);
  });

  it('forgets the oldest addresses beyond its memory bound', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxStarts: 1, maxTrackedIps: 2 }, () => 0);
    limiter.attempt('a');
    limiter.attempt('b');
    limiter.attempt('c');
    expect(limiter.attempt('a').allowed).toBe(true);
    expect(limiter.attempt('c').allowed).toBe(false);
  });

  it('uses the address the trusted proxy appended, never one the client wrote further left', () => {
    const req = (xff: string | undefined) => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: '127.0.0.1' } }) as never;
    expect(clientAddress(req('1.1.1.1, 203.0.113.7'))).toBe('203.0.113.7');
    expect(clientAddress(req(undefined))).toBe('127.0.0.1');
  });
});

describe('judge access: POST /judge/jobs', () => {
  it('is off (404) when JUDGE_ACCESS_TOKEN is unset or too short', async () => {
    expect(judgeAccessFromEnv(undefined)).toBeNull();
    expect(judgeAccessFromEnv('x'.repeat(MIN_JUDGE_TOKEN_LENGTH - 1))).toBeNull();
    const h = await startHarness();
    expect((await judgePost(h, { 'X-Judge-Token': JUDGE_CODE })).status).toBe(404);
  });

  it('refuses a wrong or missing code with 403 and starts nothing', async () => {
    const h = await startHarness({ judge: judgeAccessFromEnv(JUDGE_CODE) });
    const wrong = await judgePost(h, { 'X-Judge-Token': 'not-the-judge-code-0123456789' });
    expect(wrong.status).toBe(403);
    expect(wrong.json).toEqual({ error: 'judge-access-denied', message: ERROR_COPY['judge-access-denied'] });
    expect((await judgePost(h)).status).toBe(403);
    expect(h.runs()).toBe(0);
  });

  it('bypasses the per-session busy limit and the IP limit, up to its own cap', async () => {
    const gate = deferred();
    const h = await startHarness({
      judge: judgeAccessFromEnv(JUDGE_CODE),
      runPipeline: gatedPipeline(gate.promise),
      rateLimit: { windowMs: 60_000, maxStarts: 1, maxTrackedIps: 10 },
    });
    // One public job from this session and address: the next public one is refused.
    expect((await h.post(heartBody)).status).toBe(202);
    expect((await h.post(heartBody, { 'Idempotency-Key': KEY_2 })).status).toBe(429);
    // The same session through the judge route starts jobs anyway, up to MAX_ACTIVE_JUDGE_JOBS.
    for (let i = 0; i < MAX_ACTIVE_JUDGE_JOBS; i += 1) {
      const res = await judgePost(h, { 'X-Judge-Token': JUDGE_CODE, 'Idempotency-Key': `judge-key-${i}` });
      expect(res.status).toBe(202);
    }
    const over = await judgePost(h, { 'X-Judge-Token': JUDGE_CODE, 'Idempotency-Key': 'judge-key-over' });
    expect(over.status).toBe(429);
    expect(over.json).toMatchObject({ error: 'capacity' });
    gate.release();
  });

  it('still spends from the daily budget: an exhausted ledger fails the judge job too', async () => {
    const h = await startHarness({ judge: judgeAccessFromEnv(JUDGE_CODE) });
    // Spend the harness ledger's whole $1 cap first.
    const reservation = await h.ledger.reserve(1);
    expect(reservation.ok).toBe(true);
    const created = await judgePost(h, { 'X-Judge-Token': JUDGE_CODE });
    expect(created.status).toBe(202);
    const done = await h.waitDone((created.json as { jobId: string }).jobId);
    expect(done.json).toMatchObject({ status: 'failed', failure: { kind: 'budget-exhausted' } });
    expect(h.provider.calls).toBe(0);
  });

  it('lets a browser on WEB_ORIGIN send the judge header, and never logs the code', async () => {
    expect(ALLOWED_HEADERS).toContain('X-Judge-Token');
    const h = await startHarness({ judge: judgeAccessFromEnv(JUDGE_CODE) });
    await judgePost(h, { 'X-Judge-Token': JUDGE_CODE });
    expect(JSON.stringify(h.logs)).not.toContain(JUDGE_CODE);
    expect(h.logs.some((l) => l['route'] === 'POST /judge/jobs')).toBe(true);
  });
});
