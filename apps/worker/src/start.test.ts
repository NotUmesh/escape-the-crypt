import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './config';
import type { Logger, LogFields } from './http/respond';
import { start, type RunningWorker } from './start';

/**
 * Smoke test for the process entry point. No network and no real key.
 * The OpenAI SDK captures `globalThis.fetch` when its client is constructed (7.64.0,
 * `internal/shims.js`), and `start` constructs it. The stub is installed before every `start`, so
 * any SDK request would hit the spy. Test requests use `node:http` to 127.0.0.1 instead of fetch.
 */

const DUMMY_KEY = 'test-dummy-key-not-real';
const ORIGIN = 'https://crypt.example.test';
const MODEL = 'model-under-test';
const BUDGET = '7.4321';
const PRICE_IN = '1.2345';
const PRICE_OUT = '6.7891';

const FULL_ENV: Env = {
  OPENAI_API_KEY: DUMMY_KEY,
  WEB_ORIGIN: ORIGIN,
  OPENAI_MODEL: MODEL,
  DAILY_BUDGET_USD: BUDGET,
  PRICE_INPUT_USD_PER_MTOK: PRICE_IN,
  PRICE_OUTPUT_USD_PER_MTOK: PRICE_OUT,
  PORT: '0',
};

const NOTES = readFileSync(fileURLToPath(new URL('../../../samples/human-heart.txt', import.meta.url)), 'utf8');
const TOKEN = 'tok-A_0123456789abcdefghij';

interface Reply {
  readonly status: number;
  readonly json: unknown;
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function capture(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const push = (f: LogFields): void => void lines.push(JSON.stringify(f));
  return { logger: { info: push, error: push }, lines };
}

const running: RunningWorker[] = [];
let fetchSpy: ReturnType<typeof vi.fn>;

async function startOk(env: Env, logger?: Logger): Promise<RunningWorker> {
  const result = await start(env, { ...(logger === undefined ? {} : { logger }), sweepIntervalMs: 50 });
  if (!result.ok) throw new Error(`start failed: ${result.error.kind}`);
  running.push(result.value);
  return result.value;
}

async function createJob(port: number): Promise<Reply> {
  return call(
    port,
    'POST',
    '/jobs',
    { 'X-Session-Token': TOKEN, 'Idempotency-Key': 'idem-key-0001', 'Content-Type': 'application/json' },
    JSON.stringify({ notesText: NOTES, runLength: 'short' }),
  );
}

async function settle(port: number, jobId: string): Promise<Reply> {
  for (let i = 0; i < 300; i += 1) {
    const reply = await call(port, 'GET', `/jobs/${jobId}`, { 'X-Session-Token': TOKEN });
    const status = (reply.json as { status?: string } | null)?.status;
    if (status !== 'queued' && status !== 'running') return reply;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job did not settle');
}

beforeEach(() => {
  fetchSpy = vi.fn(() => {
    throw new Error('network access attempted in a test');
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((w) => w.close()));
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('start: everything configured', () => {
  it('serves /health ok on an OS-chosen port and logs no env values', async () => {
    const { logger, lines } = capture();
    const worker = await startOk(FULL_ENV, logger);

    expect(worker.port).toBeGreaterThan(0);
    expect(worker.server.listening).toBe(true);
    const health = await call(worker.port, 'GET', '/health');
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ status: 'ok' });

    const startup = lines.join('\n');
    expect(startup).toContain('listening');
    for (const secret of [DUMMY_KEY, ORIGIN, 'crypt.example.test', BUDGET, PRICE_IN, PRICE_OUT, MODEL]) {
      expect(startup).not.toContain(secret);
    }
  });
});

describe('start: budget not configured', () => {
  const cases: readonly [string, Env][] = [
    ['DAILY_BUDGET_USD is missing', { ...FULL_ENV, DAILY_BUDGET_USD: undefined }],
    ['DAILY_BUDGET_USD is invalid', { ...FULL_ENV, DAILY_BUDGET_USD: 'lots' }],
    ['both prices are missing', { ...FULL_ENV, PRICE_INPUT_USD_PER_MTOK: undefined, PRICE_OUTPUT_USD_PER_MTOK: undefined }],
    ['one price is missing', { ...FULL_ENV, PRICE_OUTPUT_USD_PER_MTOK: undefined }],
    ['a price is invalid', { ...FULL_ENV, PRICE_INPUT_USD_PER_MTOK: '-3' }],
  ];

  it.each(cases)('still serves /health and ends the job budget-exhausted when %s', async (_name, env) => {
    const worker = await startOk(env);

    const health = await call(worker.port, 'GET', '/health');
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ status: 'budget-not-configured' });

    const created = await createJob(worker.port);
    expect(created.status).toBe(202);
    const { jobId } = created.json as { jobId: string };
    const done = await settle(worker.port, jobId);
    expect(done.status).toBe(200);
    const body = done.json as { status: string; failure?: { kind: string } };
    expect(body.status).toBe('failed');
    expect(body.failure?.kind).toBe('budget-exhausted');
    // Asserted again in afterEach for every test: the SDK never reached the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('start: invalid configuration returns a typed error', () => {
  const cases: readonly [string, Env, string][] = [
    ['OPENAI_API_KEY missing', { ...FULL_ENV, OPENAI_API_KEY: undefined }, 'missing-api-key'],
    ['WEB_ORIGIN missing', { ...FULL_ENV, WEB_ORIGIN: undefined }, 'missing-web-origin'],
    ['OPENAI_MODEL missing', { ...FULL_ENV, OPENAI_MODEL: undefined }, 'missing-model'],
    ['PORT not a number', { ...FULL_ENV, PORT: 'abc' }, 'invalid-port'],
    ['PORT out of range', { ...FULL_ENV, PORT: '70000' }, 'invalid-port'],
    ['JOB_TTL_MINUTES not a number', { ...FULL_ENV, JOB_TTL_MINUTES: 'soon' }, 'invalid-job-ttl'],
    ['JOB_TTL_MINUTES zero', { ...FULL_ENV, JOB_TTL_MINUTES: '0' }, 'invalid-job-ttl'],
    ['DISABLED_LOCK_TYPES has an unknown entry', { ...FULL_ENV, DISABLED_LOCK_TYPES: 'not-a-lock-type' }, 'invalid-disabled-lock-types'],
    [
      'DISABLED_LOCK_TYPES leaves fewer than two types',
      { ...FULL_ENV, DISABLED_LOCK_TYPES: 'seance-board,bone-ordering,bound-threads,cursed-object,combination-dial' },
      'too-few-lock-types',
    ],
  ];

  it.each(cases)('%s', async (_name, env, kind) => {
    const { logger, lines } = capture();
    const result = await start(env, { logger });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(kind);
    // No startup line means it never reached listen.
    expect(lines.join('\n')).not.toContain('listening');
  });
});

describe('start: DISABLED_LOCK_TYPES', () => {
  it('starts with a reduced list and logs the counts and names, not the raw value', async () => {
    const { logger, lines } = capture();
    await startOk({ ...FULL_ENV, DISABLED_LOCK_TYPES: ' Bone-Ordering ,combination-dial' }, logger);
    const listening = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l['note'] === 'listening');
    expect(listening?.['enabledLockTypeCount']).toBe(4);
    expect(listening?.['disabledLockTypes']).toBe('bone-ordering,combination-dial');
  });

  it('passes the filtered list, not the constant, to pipelineSettings', () => {
    const source = readFileSync(fileURLToPath(new URL('./start.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/allowedLockTypes:\s*cfg\.allowedLockTypes/);
    expect(source).not.toContain('ALLOWED_LOCK_TYPES');
  });
});

describe('close', () => {
  it('clears the sweep timer and stops listening', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const worker = await startOk(FULL_ENV);
    expect(worker.server.listening).toBe(true);

    await worker.close();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(worker.server.listening).toBe(false);
    await expect(worker.close()).resolves.toBeUndefined();
    await expect(call(worker.port, 'GET', '/health')).rejects.toThrow();
  });
});
