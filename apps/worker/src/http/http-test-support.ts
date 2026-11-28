import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  countingProvider,
  makeCassetteProvider,
  makeMockLedger,
  parseCassetteFile,
  runRoomPipeline,
  type CountingProvider,
  type MockLedger,
  type PipelineJobError,
  type PipelineProgress,
  type PipelineRunMetadata,
  type Provider,
} from '@escape-the-crypt/core';
import { createJobStore, type JobStore } from '../jobs/job-store';
import type { PipelineSettings, RunPipeline } from './job-runner';
import type { LogFields, Logger } from './respond';
import { createServer } from './server';
import type { JudgeAccess } from './judge-access';
import type { RateLimitConfig } from './rate-limit';

export const WEB_ORIGIN = 'https://crypt.example.test';
export const LOOPBACK = '127.0.0.1';
export const TOKEN = 'tok-A_0123456789abcdefghij';
export const TOKEN_B = 'tok-B_0123456789abcdefghij';
export const KEY = 'idem-key-0001';
export const KEY_2 = 'idem-key-0002';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The notes the cassette was recorded for. */
export const HEART_NOTES = readFileSync(`${repoRoot}samples/human-heart.txt`, 'utf8');

/** The recorded concept-extraction response, reused as a canned answer. Its digest is irrelevant. */
export function heartExtractionJson(): unknown {
  const first = loadCassette().entries[0]?.response;
  if (first === undefined || !first.ok) throw new Error('cassette has no extraction response');
  return first.json;
}

function loadCassette() {
  const path = `${repoRoot}packages/core/src/test-support/cassettes/human-heart-e2e.json`;
  const parsed = parseCassetteFile(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.ok) throw new Error('human-heart-e2e.json does not parse as a cassette');
  return parsed.value;
}

/**
 * Identical to `HUMAN_HEART_E2E_OPTIONS` in
 * `packages/core/src/pipeline/e2e-cassette-fixtures.ts` (not exported from core's index).
 * Any difference changes every Prompt_Digest and the cassette stops matching.
 */
export const HEART_SETTINGS: PipelineSettings = {
  modelId: 'synthetic-e2e',
  temperature: 0,
  maxOutputTokens: 2000,
  timeoutMs: 30000,
  retryLimit: 0,
  worstCaseUsd: 0.01,
  costOf: () => 0.001,
  concurrency: 1,
  // Pinned, as in HUMAN_HEART_E2E_OPTIONS: the cassette was recorded with two types, and the default is now six.
  allowedLockTypes: ['rune-cipher', 'seance-board'],
  // Pinned off: a later default change must not silently alter recorded digests.
  conflictCheck: false,
  sufficiency: false,
};
export const HEART_PROVIDER_NAME = 'synthetic';

/** Failure metadata is only read for `calls.length`; the runner never inspects the rest. */
export const EMPTY_METADATA = { calls: [] } as unknown as PipelineRunMetadata;

export const failingPipeline =
  (error: PipelineJobError): RunPipeline =>
  async () => ({ ok: false, error: { error, metadata: EMPTY_METADATA } });

/** Waits for `gate`, then fails with `empty-room`. Keeps a job running until the test releases it. */
export const gatedPipeline =
  (gate: Promise<void>): RunPipeline =>
  async (notes, options) => {
    await gate;
    return failingPipeline({ kind: 'empty-room' })(notes, options);
  };

/** Reports `steps` through the pipeline's own progress callback, waits for `gate`, then fails cheaply. */
export function reportingPipeline(steps: readonly PipelineProgress[], gate: Deferred): RunPipeline {
  return async (notes, options) => {
    for (const step of steps) options.onProgress?.(step);
    await gate.promise;
    return failingPipeline({ kind: 'empty-room' })(notes, options);
  };
}
export interface Deferred {
  readonly promise: Promise<void>;
  readonly release: () => void;
}
export function deferred(): Deferred {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export interface HttpResult {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: unknown;
}

export interface Harness {
  readonly base: string;
  readonly clock: { t: number };
  readonly store: JobStore;
  readonly ledger: MockLedger;
  readonly provider: CountingProvider;
  /** Number of times the server started a pipeline run. */
  readonly runs: () => number;
  readonly logs: LogFields[];
  request(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResult>;
  post(body: unknown, headers?: Record<string, string>): Promise<HttpResult>;
  get(jobId: string, token?: string): Promise<HttpResult>;
  /** Polls until the job leaves queued/running. Bounded. */
  waitDone(jobId: string, token?: string): Promise<HttpResult>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly runPipeline?: RunPipeline;
  readonly jobTtlMs?: number;
  readonly maxBodyBytes?: number;
  /** Replaces the cassette provider (still wrapped by countingProvider). */
  readonly provider?: Provider;
  readonly pipelineSettings?: PipelineSettings;
  /** Injected so a test can inspect it. Defaults to a fresh map owned by the harness. */
  readonly controllers?: Map<string, AbortController>;
  /** Judge access, as `start` builds it from `JUDGE_ACCESS_TOKEN`. Default: off. */
  readonly judge?: JudgeAccess | null;
  readonly rateLimit?: RateLimitConfig;
  /** As `start` passes it from `TRUSTED_PROXY_HOPS`. Default: the server's default. */
  readonly trustedProxyHops?: number;
}

const open = new Set<Harness>();
export async function closeAll(): Promise<void> {
  await Promise.all([...open].map((h) => h.close()));
  open.clear();
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const clock = { t: 1_000_000 };
  const logs: LogFields[] = [];
  const logger: Logger = { info: (f) => logs.push(f), error: (f) => logs.push(f) };
  const store = createJobStore({
    now: () => clock.t,
    ...(options.jobTtlMs === undefined ? {} : { jobTtlMs: options.jobTtlMs }),
  });
  const ledger = makeMockLedger({ dailyCapUsd: 1 });
  const provider = countingProvider(options.provider ?? makeCassetteProvider(loadCassette()));
  const inner: RunPipeline = options.runPipeline ?? runRoomPipeline;
  let runCount = 0;
  const runPipeline: RunPipeline = (notes, opts) => {
    runCount += 1;
    return inner(notes, opts);
  };
  const server = createServer({
    jobStore: store,
    provider,
    providerName: HEART_PROVIDER_NAME,
    ledger,
    pipelineSettings: options.pipelineSettings ?? HEART_SETTINGS,
    ...(options.controllers === undefined ? {} : { controllers: options.controllers }),
    now: () => clock.t,
    runPipeline,
    webOrigin: WEB_ORIGIN,
    logger,
    ...(options.maxBodyBytes === undefined ? {} : { limits: { maxBodyBytes: options.maxBodyBytes } }),
    ...(options.judge === undefined ? {} : { judge: options.judge }),
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    ...(options.trustedProxyHops === undefined ? {} : { trustedProxyHops: options.trustedProxyHops }),
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const base = `http://${LOOPBACK}:${(server.address() as AddressInfo).port}`;

  const request: Harness['request'] = async (path, init = {}) => {
    const url = new URL(path, base);
    if (url.hostname !== LOOPBACK) throw new Error(`refusing non-loopback request to ${url.hostname}`);
    const res = await fetch(url, init);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, text, json };
  };
  const post: Harness['post'] = (body, headers = {}) =>
    request('/jobs', {
      method: 'POST',
      headers: { 'X-Session-Token': TOKEN, 'Idempotency-Key': KEY, 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const get: Harness['get'] = (jobId, token = TOKEN) =>
    request(`/jobs/${encodeURIComponent(jobId)}`, { headers: { 'X-Session-Token': token } });
  const waitDone: Harness['waitDone'] = async (jobId, token = TOKEN) => {
    for (let i = 0; i < 400; i += 1) {
      const res = await get(jobId, token);
      const status = (res.json as { status?: string } | null)?.status;
      if (status !== 'queued' && status !== 'running') return res;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job did not finish in time');
  };

  const harness: Harness = {
    base,
    clock,
    store,
    ledger,
    provider,
    runs: () => runCount,
    logs,
    request,
    post,
    get,
    waitDone,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  open.add(harness);
  return harness;
}

export const stableHeaders = (h: Headers): Record<string, string> =>
  Object.fromEntries([...h.entries()].filter(([k]) => k !== 'date').sort(([a], [b]) => (a < b ? -1 : 1)));

export const heartBody = { notesText: HEART_NOTES, runLength: 'short' } as const;
