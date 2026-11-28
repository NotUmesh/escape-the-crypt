import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProviderRequest } from '@escape-the-crypt/core';
import { costOfUsage } from '../budget/interim-ledger';
import { GEMINI_BASE_URL, makeGeminiProvider, type FetchLike } from './gemini-provider';
import type { ProviderLogEvent } from './openai-provider';

const API_KEY = 'AIza-test-KEY-never-logged-5521';
const SYSTEM_TEXT = 'SYSTEM-PROMPT-TEXT-aaa';
const USER_TEXT = 'USER-MESSAGE-TEXT-bbb';
const ASSISTANT_TEXT = 'ASSISTANT-MESSAGE-TEXT-ccc';
const RESPONSE_TEXT = 'RESPONSE-BODY-TEXT-ddd';
const ERROR_BODY = 'SENTINEL-error-body-7731';

const schema = {
  type: 'object',
  properties: { kind: { type: 'string', const: 'rune-cipher' }, n: { type: 'integer', exclusiveMinimum: 0 } },
  required: ['kind', 'n'],
  additionalProperties: false,
};

function makeRequest(over: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    stage: 'generation',
    promptVersion: 'v1',
    modelId: 'gemini-test-model',
    system: SYSTEM_TEXT,
    messages: [
      { role: 'user', content: USER_TEXT },
      { role: 'assistant', content: ASSISTANT_TEXT },
      { role: 'user', content: 'second user turn' },
    ],
    temperature: 0.2,
    maxOutputTokens: 321,
    jsonSchema: schema,
    timeoutMs: 4567,
    retryLimit: 0,
    ...over,
  };
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function okBody(text: string = JSON.stringify({ kind: 'rune-cipher', n: RESPONSE_TEXT.length }), extra: Record<string, unknown> = {}): unknown {
  return {
    candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, thoughtsTokenCount: 5, totalTokenCount: 23 },
    modelVersion: 'gemini-test-model-001',
    ...extra,
  };
}

function fakeFetch(...responses: (() => Promise<Response>)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next === undefined) throw new Error('no response scripted');
    return next();
  };
  return { fetch, calls };
}

const noSleep = (): Promise<void> => Promise.resolve();

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error('network access is forbidden in this test file');
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('request shape', () => {
  it('posts generateContent with the key in a header and the adapted strict schema', async () => {
    const { fetch, calls } = fakeFetch(async () => reply(okBody()));
    await makeGeminiProvider({ apiKey: API_KEY, fetch }).complete(makeRequest());

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${GEMINI_BASE_URL}/models/gemini-test-model:generateContent`);
    expect(call.url).not.toContain(API_KEY);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY });
    expect(JSON.parse(String(call.init.body))).toEqual({
      systemInstruction: { parts: [{ text: SYSTEM_TEXT }] },
      contents: [
        { role: 'user', parts: [{ text: USER_TEXT }] },
        { role: 'model', parts: [{ text: ASSISTANT_TEXT }] },
        { role: 'user', parts: [{ text: 'second user turn' }] },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 321,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['rune-cipher'] }, n: { type: 'integer', minimum: 1 } },
          required: ['kind', 'n'],
          additionalProperties: false,
        },
      },
    });
  });

  it('refuses a model ID that is not a bare ID, without calling', async () => {
    const { fetch, calls } = fakeFetch(async () => reply(okBody()));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch }).complete(makeRequest({ modelId: '../v1beta/models/x' }));
    expect(result).toEqual({ ok: false, error: { kind: 'provider-error', retryable: false } });
    expect(calls).toHaveLength(0);
  });
});

describe('success and usage', () => {
  it('parses the JSON text and counts thinking tokens as output', async () => {
    const { fetch } = fakeFetch(async () => reply(okBody()));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch }).complete(makeRequest());
    expect(result).toEqual({ ok: true, json: { kind: 'rune-cipher', n: RESPONSE_TEXT.length }, usage: { inputTokens: 11, outputTokens: 12 } });
  });

  it('prices that usage with the same cost function as OpenAI', async () => {
    const { fetch } = fakeFetch(async () => reply(okBody()));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch }).complete(makeRequest());
    if (!result.ok) throw new Error('expected success');
    // 11 input at $2/M + 12 output (7 answer + 5 thinking) at $10/M.
    expect(costOfUsage(result.usage, { inputUsdPerMTok: 2, outputUsdPerMTok: 10 })).toBeCloseTo((11 * 2 + 12 * 10) / 1_000_000, 12);
  });

  it('adds tool-use prompt tokens to input, maps absent usage to 0 and skips thought parts', async () => {
    const withTools = fakeFetch(async () =>
      reply({ ...(okBody() as object), usageMetadata: { promptTokenCount: 3, toolUsePromptTokenCount: 2, candidatesTokenCount: 1 } }),
    );
    expect(await makeGeminiProvider({ apiKey: API_KEY, fetch: withTools.fetch }).complete(makeRequest())).toMatchObject({ usage: { inputTokens: 5, outputTokens: 1 } });

    const bare = fakeFetch(async () =>
      reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"a":' }, { text: '1}' }] } }] }),
    );
    expect(await makeGeminiProvider({ apiKey: API_KEY, fetch: bare.fetch }).complete(makeRequest())).toEqual({ ok: true, json: { a: 1 }, usage: { inputTokens: 0, outputTokens: 0 } });
  });

  it('passes schema-valid-looking JSON through unvalidated: the caller parses it with Zod', async () => {
    const { fetch } = fakeFetch(async () => reply(okBody(JSON.stringify({ unexpected: true }))));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch }).complete(makeRequest());
    expect(result).toMatchObject({ ok: true, json: { unexpected: true } });
  });
});

describe('invalid, refused and blocked replies', () => {
  const bad: readonly [string, unknown][] = [
    ['text that is not JSON', okBody('{not json')],
    ['an envelope that does not match the response shape', { candidates: 'nope' }],
    ['a blocked prompt (promptFeedback.blockReason)', { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 9 } }],
    ['a SAFETY finish', { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{}' }] } }] }],
    ['a PROHIBITED_CONTENT finish', { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }],
    ['a RECITATION finish', { candidates: [{ finishReason: 'RECITATION', content: { parts: [{ text: '{}' }] } }] }],
    ['a MAX_TOKENS finish', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }] }],
    ['no finish reason', { candidates: [{ content: { parts: [{ text: '{}' }] } }] }],
    ['no candidates', { candidates: [] }],
    ['only thought parts', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}', thought: true }] } }] }],
    ['a body that is not JSON at all', '<html>oops</html>'],
  ];

  it.each(bad)('%s gives invalid-response-shape, not retryable, with one attempt', async (_name, body) => {
    const { fetch, calls } = fakeFetch(async () => reply(body));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, sleep: noSleep }).complete(makeRequest({ retryLimit: 3 }));
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-response-shape', retryable: false } });
    expect(calls).toHaveLength(1);
  });
});

describe('HTTP errors and retries', () => {
  const cases: readonly (readonly [number, string, boolean])[] = [
    [429, 'rate-limited', true],
    ...[408, 409, 500, 503].map((s) => [s, 'provider-error', true] as const),
    ...[400, 401, 403, 404].map((s) => [s, 'provider-error', false] as const),
  ];

  it.each(cases)('%i gives %s (retryable %s) and retries only when retryable', async (status, kind, retryable) => {
    const { fetch, calls } = fakeFetch(async () => reply({ error: { message: ERROR_BODY } }, status));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, sleep: noSleep }).complete(makeRequest({ retryLimit: 2 }));
    expect(result).toEqual({ ok: false, error: { kind, retryable } });
    expect(calls).toHaveLength(retryable ? 3 : 1);
  });

  it('recovers when a retry succeeds, backing off exponentially or by Retry-After', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number): Promise<void> => void waits.push(ms);
    const { fetch, calls } = fakeFetch(
      async () => reply({}, 503),
      async () => reply({}, 429, { 'Retry-After': '3' }),
      async () => reply(okBody()),
    );
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, sleep }).complete(makeRequest({ retryLimit: 2 }));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([500, 3000]);
  });

  it('treats a network failure as a retryable provider-error', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, sleep: noSleep }).complete(makeRequest({ retryLimit: 1 }));
    expect(result).toEqual({ ok: false, error: { kind: 'provider-error', retryable: true } });
    expect(calls).toHaveLength(2);
  });

  it('never rejects when fetch throws synchronously', async () => {
    const fetch: FetchLike = () => {
      throw new Error('boom');
    };
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, sleep: noSleep }).complete(makeRequest());
    expect(result).toEqual({ ok: false, error: { kind: 'provider-error', retryable: true } });
  });
});

describe('timeout', () => {
  /** Never answers; rejects with an AbortError when the provider aborts the request. */
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });

  it('aborts after timeoutMs and returns a retryable timeout', async () => {
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch: hanging }).complete(makeRequest({ timeoutMs: 20 }));
    expect(result).toEqual({ ok: false, error: { kind: 'timeout', retryable: true } });
  });

  it('retries a timeout up to retryLimit times, each attempt with its own timeout', async () => {
    let attempts = 0;
    const fetch: FetchLike = (url, init) => {
      attempts += 1;
      return hanging(url, init);
    };
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, sleep: noSleep }).complete(makeRequest({ timeoutMs: 15, retryLimit: 2 }));
    expect(result).toEqual({ ok: false, error: { kind: 'timeout', retryable: true } });
    expect(attempts).toBe(3);
  });

  it('times out a reply whose body stalls', async () => {
    const fetch: FetchLike = async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"candidates":['));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { status: 200 });
    };
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch }).complete(makeRequest({ timeoutMs: 20 }));
    expect(result).toEqual({ ok: false, error: { kind: 'timeout', retryable: true } });
  });
});

describe('logging', () => {
  it('logs only content-free keys, for success and failure', async () => {
    const events: ProviderLogEvent[] = [];
    let tick = 0;
    const now = (): number => (tick += 40);
    const ok = fakeFetch(async () => reply(okBody()));
    await makeGeminiProvider({ apiKey: API_KEY, fetch: ok.fetch, now, logger: (e) => void events.push(e) }).complete(makeRequest());
    const failing = fakeFetch(async () => reply({ error: { message: ERROR_BODY } }, 500));
    await makeGeminiProvider({ apiKey: API_KEY, fetch: failing.fetch, now, sleep: noSleep, logger: (e) => void events.push(e) }).complete(makeRequest());

    expect(events).toEqual([
      { stage: 'generation', modelId: 'gemini-test-model', elapsedMs: 40, inputTokens: 11, outputTokens: 12, outcome: 'ok' },
      { stage: 'generation', modelId: 'gemini-test-model', elapsedMs: 40, inputTokens: 0, outputTokens: 0, outcome: 'provider-error' },
    ]);
    const serialised = JSON.stringify(events);
    for (const secret of [SYSTEM_TEXT, USER_TEXT, ASSISTANT_TEXT, RESPONSE_TEXT, API_KEY, ERROR_BODY]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('survives a throwing logger', async () => {
    const { fetch } = fakeFetch(async () => reply(okBody()));
    const logger = vi.fn(() => {
      throw new Error('logger boom');
    });
    const result = await makeGeminiProvider({ apiKey: API_KEY, fetch, logger }).complete(makeRequest());
    expect(logger).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

describe('construction', () => {
  it('throws for an empty key, with a message that names the variable only', () => {
    expect(() => makeGeminiProvider({ apiKey: '  ' })).toThrow('GEMINI_API_KEY is not set');
  });
});
