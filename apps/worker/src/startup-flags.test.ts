import { afterEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_ERROR_COPY, readConfig, type Env } from './config';
import { KEY, TOKEN, closeAll, deferred, gatedPipeline, heartBody, startHarness } from './http/http-test-support';
import { judgeAccessStatus } from './http/judge-access';
import { parseTrustedProxyHops } from './http/rate-limit';
import type { LogFields } from './http/respond';
import { start, type RunningWorker } from './start';

const BASE: Env = {
  OPENAI_API_KEY: 'sk-dummy-not-real',
  OPENAI_MODEL: 'model-under-test',
  WEB_ORIGIN: 'https://crypt.example.test',
  DAILY_BUDGET_USD: '5',
  PRICE_INPUT_USD_PER_MTOK: '1',
  PRICE_OUTPUT_USD_PER_MTOK: '4',
  PORT: '0',
};
const GOOD_CODE = 'judge-code-0123456789-abcdefghij';
const SHORT_CODE = 'short-code-0123';

const running: RunningWorker[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((w) => w.close()));
  await closeAll();
  vi.unstubAllGlobals();
});

/** Starts the real worker (no network: fetch throws) and returns its log lines as objects. */
async function startupLines(env: Env): Promise<LogFields[]> {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access attempted in a test');
  });
  const lines: LogFields[] = [];
  const push = (f: LogFields): void => void lines.push(f);
  const result = await start(env, { logger: { info: push, error: push } });
  if (!result.ok) throw new Error(`start failed: ${result.error.kind}`);
  running.push(result.value);
  return lines;
}
const judgeLine = (lines: readonly LogFields[]): LogFields[] => lines.filter((l) => l['note'] === 'judge access');

describe('startup log: judge access', () => {
  it.each([
    ['enabled', GOOD_CODE, { judgeAccess: 'enabled' }],
    ['disabled when unset', undefined, { judgeAccess: 'disabled', judgeAccessReason: 'unset' }],
    ['disabled when blank', '   ', { judgeAccess: 'disabled', judgeAccessReason: 'unset' }],
    ['disabled when shorter than 24 characters', SHORT_CODE, { judgeAccess: 'disabled', judgeAccessReason: 'shorter-than-24-characters' }],
  ] as const)('logs one line: %s', async (_name, code, expected) => {
    const lines = await startupLines(code === undefined ? BASE : { ...BASE, JUDGE_ACCESS_TOKEN: code });
    expect(judgeLine(lines)).toEqual([{ event: 'startup', note: 'judge access', ...expected }]);
  });

  it('never logs the code or its length, for a good or a short code', async () => {
    for (const code of [GOOD_CODE, SHORT_CODE]) {
      const lines = await startupLines({ ...BASE, JUDGE_ACCESS_TOKEN: code });
      const text = JSON.stringify(lines);
      expect(text).not.toContain(code);
      expect(text).not.toContain(code.slice(0, 10));
      // No logged number on any startup line equals the code's length.
      const numbers = lines.filter((l) => l['event'] === 'startup').flatMap((l) => Object.values(l).filter((v): v is number => typeof v === 'number'));
      expect(numbers).not.toContain(code.length);
    }
  });

  it('judgeAccessStatus matches what judgeAccessFromEnv turns on', () => {
    expect(judgeAccessStatus('x'.repeat(24))).toEqual({ judgeAccess: 'enabled' });
    expect(judgeAccessStatus(`  ${'x'.repeat(23)}  `)).toMatchObject({ judgeAccess: 'disabled' });
  });
});

describe('TRUSTED_PROXY_HOPS', () => {
  it('defaults to 1, takes a whole number from 0 to 3, and trims spaces', () => {
    expect([undefined, '', '  '].map(parseTrustedProxyHops)).toEqual([1, 1, 1]);
    expect(['0', '1', '2', '3', ' 2 '].map(parseTrustedProxyHops)).toEqual([0, 1, 2, 3, 2]);
  });

  it.each(['4', '-1', '1.0', '1e0', 'two', '01', '0x1', '1,2'])('refuses "%s" at startup, before listening', async (value) => {
    expect(parseTrustedProxyHops(value)).toBeNull();
    expect(readConfig({ ...BASE, TRUSTED_PROXY_HOPS: value })).toEqual({ ok: false, error: { kind: 'invalid-trusted-proxy-hops' } });
    const lines: LogFields[] = [];
    const result = await start({ ...BASE, TRUSTED_PROXY_HOPS: value }, { logger: { info: (f) => void lines.push(f), error: (f) => void lines.push(f) } });
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-trusted-proxy-hops' } });
    expect(lines.some((l) => l['note'] === 'listening')).toBe(false);
  });

  it('has a clear startup message that names the variable and the range, and no value', () => {
    expect(STARTUP_ERROR_COPY['invalid-trusted-proxy-hops']).toBe('TRUSTED_PROXY_HOPS must be a whole number from 0 to 3 (unset means 1)');
  });

  it('shows the value in use on the listening line', async () => {
    const lines = await startupLines({ ...BASE, TRUSTED_PROXY_HOPS: '2' });
    expect(lines.find((l) => l['note'] === 'listening')).toMatchObject({ trustedProxyHops: 2 });
    const defaults = await startupLines(BASE);
    expect(defaults.find((l) => l['note'] === 'listening')).toMatchObject({ trustedProxyHops: 1 });
  });

  it('with 2 hops, two visitors behind the same second proxy get separate limits', async () => {
    const limit = { windowMs: 60_000, maxStarts: 1, maxTrackedIps: 100 };
    const post = (h: Awaited<ReturnType<typeof startHarness>>, client: string, i: number) =>
      h.post(heartBody, { 'X-Session-Token': `${TOKEN}-${i}`, 'Idempotency-Key': `${KEY}-${i}`, 'X-Forwarded-For': `${client}, 10.9.9.9` });
    // One hop: the last entry is the shared second proxy, so the second visitor is refused.
    const one = await startHarness({ runPipeline: gatedPipeline(deferred().promise), rateLimit: limit });
    expect([(await post(one, '198.51.100.1', 1)).status, (await post(one, '198.51.100.2', 2)).status]).toEqual([202, 429]);
    // Two hops: each visitor's own address is used.
    const two = await startHarness({ runPipeline: gatedPipeline(deferred().promise), rateLimit: limit, trustedProxyHops: 2 });
    expect([(await post(two, '198.51.100.1', 1)).status, (await post(two, '198.51.100.2', 2)).status]).toEqual([202, 202]);
    expect((await post(two, '198.51.100.1', 3)).status).toBe(429);
  });
});
