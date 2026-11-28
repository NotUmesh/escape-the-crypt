import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_LOCK_TYPES, STARTUP_ERROR_COPY, readConfig, type Env } from './config';
import type { LogFields, Logger } from './http/respond';
import { start } from './start';

const GEMINI_KEY = 'AIza-dummy-key-not-real';
const BASE: Env = { WEB_ORIGIN: 'https://crypt.example.test', DAILY_BUDGET_USD: '5', PORT: '0' };
const GEMINI_ENV: Env = {
  ...BASE,
  PROVIDER: 'gemini',
  GEMINI_API_KEY: GEMINI_KEY,
  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_PRICE_INPUT_USD_PER_MTOK: '0.3',
  GEMINI_PRICE_OUTPUT_USD_PER_MTOK: '2.5',
};
const OPENAI_ENV: Env = {
  ...BASE,
  OPENAI_API_KEY: 'sk-dummy',
  OPENAI_MODEL: 'gpt-test',
  PRICE_INPUT_USD_PER_MTOK: '1',
  PRICE_OUTPUT_USD_PER_MTOK: '4',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PROVIDER', () => {
  it('defaults to openai, so an unchanged environment keeps working', () => {
    const cfg = readConfig(OPENAI_ENV);
    expect(cfg.ok && cfg.value.provider).toBe('openai');
    expect(cfg.ok && cfg.value.modelId).toBe('gpt-test');
    expect(readConfig({ ...OPENAI_ENV, PROVIDER: 'openai' })).toEqual(cfg);
  });

  it('openai ignores the Gemini settings, and gemini needs none of the OpenAI ones', () => {
    expect(readConfig({ ...OPENAI_ENV, GEMINI_MODEL: '../bad' }).ok).toBe(true);
    const cfg = readConfig(GEMINI_ENV);
    expect(cfg).toEqual({
      ok: true,
      value: {
        provider: 'gemini',
        apiKey: GEMINI_KEY,
        webOrigin: 'https://crypt.example.test',
        modelId: 'gemini-3.8-flash',
        port: 0,
        jobTtlMs: 30 * 60_000,
        dailyBudgetUsd: 5,
        prices: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
        warnings: [],
        allowedLockTypes: ALLOWED_LOCK_TYPES,
        disabledLockTypes: [],
      },
    });
  });

  it('rejects an unknown provider', () => {
    expect(readConfig({ ...OPENAI_ENV, PROVIDER: 'anthropic' })).toEqual({ ok: false, error: { kind: 'invalid-provider' } });
    expect(readConfig({ ...OPENAI_ENV, PROVIDER: 'Gemini' })).toEqual({ ok: false, error: { kind: 'invalid-provider' } });
  });
});

describe('PROVIDER=gemini: every setting is required at startup', () => {
  const cases: readonly [string, Env, string][] = [
    ['GEMINI_API_KEY missing', { ...GEMINI_ENV, GEMINI_API_KEY: undefined }, 'missing-gemini-api-key'],
    ['GEMINI_API_KEY blank', { ...GEMINI_ENV, GEMINI_API_KEY: '   ' }, 'missing-gemini-api-key'],
    ['GEMINI_MODEL missing', { ...GEMINI_ENV, GEMINI_MODEL: undefined }, 'invalid-gemini-model'],
    ['GEMINI_MODEL with a path', { ...GEMINI_ENV, GEMINI_MODEL: 'models/gemini-3.8-flash' }, 'invalid-gemini-model'],
    ['GEMINI_MODEL with a query', { ...GEMINI_ENV, GEMINI_MODEL: 'gemini?key=x' }, 'invalid-gemini-model'],
    ['input price missing', { ...GEMINI_ENV, GEMINI_PRICE_INPUT_USD_PER_MTOK: undefined }, 'invalid-gemini-input-price'],
    ['input price not a number', { ...GEMINI_ENV, GEMINI_PRICE_INPUT_USD_PER_MTOK: 'cheap' }, 'invalid-gemini-input-price'],
    ['input price zero', { ...GEMINI_ENV, GEMINI_PRICE_INPUT_USD_PER_MTOK: '0' }, 'invalid-gemini-input-price'],
    ['output price missing', { ...GEMINI_ENV, GEMINI_PRICE_OUTPUT_USD_PER_MTOK: undefined }, 'invalid-gemini-output-price'],
    ['output price negative', { ...GEMINI_ENV, GEMINI_PRICE_OUTPUT_USD_PER_MTOK: '-1' }, 'invalid-gemini-output-price'],
  ];

  it.each(cases)('%s fails before listening, with a message that names the variable and no value', async (_name, env, kind) => {
    expect(readConfig(env)).toEqual({ ok: false, error: { kind } });
    const lines: string[] = [];
    const push = (f: LogFields): void => void lines.push(JSON.stringify(f));
    const logger: Logger = { info: push, error: push };
    const result = await start(env, { logger });
    expect(result).toEqual({ ok: false, error: { kind } });
    expect(lines.join('\n')).not.toContain('listening');
    const message = STARTUP_ERROR_COPY[kind as keyof typeof STARTUP_ERROR_COPY];
    expect(message).toMatch(/GEMINI_(API_KEY|MODEL|PRICE_INPUT_USD_PER_MTOK|PRICE_OUTPUT_USD_PER_MTOK)/);
    for (const value of [GEMINI_KEY, 'cheap', 'gemini?key=x']) expect(message).not.toContain(value);
  });

  it('starts, serves /health ok and logs the provider name without calling Gemini', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access attempted in a test');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const lines: string[] = [];
    const push = (f: LogFields): void => void lines.push(JSON.stringify(f));
    const result = await start(GEMINI_ENV, { logger: { info: push, error: push } });
    if (!result.ok) throw new Error(`start failed: ${result.error.kind}`);
    try {
      const startup = lines.find((l) => l.includes('listening')) ?? '';
      expect(JSON.parse(startup)).toMatchObject({ provider: 'gemini', budgetConfigured: true });
      expect(lines.join('\n')).not.toContain(GEMINI_KEY);
    } finally {
      await result.value.close();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
