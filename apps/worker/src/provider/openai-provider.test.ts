import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import type { ProviderRequest } from '@escape-the-crypt/core';
import {
  classifyError,
  makeOpenAiProvider,
  sanitizeSchemaName,
  type ChatCompletionParams,
  type ChatCompletionRequestOptions,
  type ChatCompletionResult,
  type OpenAiClientLike,
  type ProviderLogEvent,
} from './openai-provider.js';

const SENTINEL = 'SENTINEL-sdk-error-text-9137';
const API_KEY = 'sk-test-KEY-never-logged-4411';
const SYSTEM_TEXT = 'SYSTEM-PROMPT-TEXT-aaa';
const USER_TEXT = 'USER-MESSAGE-TEXT-bbb';
const ASSISTANT_TEXT = 'ASSISTANT-MESSAGE-TEXT-ccc';
const RESPONSE_TEXT = 'RESPONSE-BODY-TEXT-ddd';

const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };

function makeRequest(): ProviderRequest {
  return {
    stage: 'generation',
    promptVersion: 'v1',
    modelId: 'test-model',
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
    retryLimit: 2,
  };
}

interface Call {
  body: ChatCompletionParams;
  options: ChatCompletionRequestOptions;
}

function fakeClient(respond: () => Promise<ChatCompletionResult>): { client: OpenAiClientLike; calls: Call[] } {
  const calls: Call[] = [];
  const client: OpenAiClientLike = {
    chat: {
      completions: {
        create: (body, options) => {
          calls.push({ body, options });
          return respond();
        },
      },
    },
  };
  return { client, calls };
}

function okResponse(content: string = JSON.stringify({ a: RESPONSE_TEXT })): ChatCompletionResult {
  return {
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  };
}

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
  it('sends the exact chat completion body and request options', async () => {
    const { client, calls } = fakeClient(async () => okResponse());
    const request = makeRequest();
    await makeOpenAiProvider({ client }).complete(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: SYSTEM_TEXT },
        { role: 'user', content: USER_TEXT },
        { role: 'assistant', content: ASSISTANT_TEXT },
        { role: 'user', content: 'second user turn' },
      ],
      temperature: 0.2,
      max_completion_tokens: 321,
      response_format: {
        type: 'json_schema',
        json_schema: { name: sanitizeSchemaName('generation'), strict: true, schema: request.jsonSchema },
      },
    });
    expect(calls[0]?.body.response_format.json_schema.schema).toBe(request.jsonSchema);
    expect(calls[0]?.options).toEqual({ timeout: 4567, maxRetries: 2 });
  });

  it('sanitizes schema names', () => {
    expect(sanitizeSchemaName('concept extraction!')).toBe('concept_extraction_');
    expect(sanitizeSchemaName('')).toBe('response');
    expect(sanitizeSchemaName('x'.repeat(100))).toHaveLength(64);
  });
});

describe('success and usage', () => {
  it('parses JSON and maps usage', async () => {
    const { client } = fakeClient(async () => okResponse());
    const result = await makeOpenAiProvider({ client }).complete(makeRequest());
    expect(result).toEqual({ ok: true, json: { a: RESPONSE_TEXT }, usage: { inputTokens: 11, outputTokens: 7 } });
  });

  it('maps absent usage to 0', async () => {
    const { client } = fakeClient(async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"a":"x"}' } }] }));
    const result = await makeOpenAiProvider({ client }).complete(makeRequest());
    expect(result).toEqual({ ok: true, json: { a: 'x' }, usage: { inputTokens: 0, outputTokens: 0 } });
  });
});

describe('error mapping', () => {
  const cases: readonly [string, () => unknown, string, boolean][] = [
    ['APIConnectionTimeoutError', () => new APIConnectionTimeoutError({ message: SENTINEL }), 'timeout', true],
    ['429 RateLimitError', () => APIError.generate(429, {}, SENTINEL, new Headers()), 'rate-limited', true],
    ['APIConnectionError', () => new APIConnectionError({ message: SENTINEL }), 'provider-error', true],
    ['408', () => APIError.generate(408, {}, SENTINEL, new Headers()), 'provider-error', true],
    ['409', () => APIError.generate(409, {}, SENTINEL, new Headers()), 'provider-error', true],
    ['500', () => APIError.generate(500, {}, SENTINEL, new Headers()), 'provider-error', true],
    ['503', () => APIError.generate(503, {}, SENTINEL, new Headers()), 'provider-error', true],
    ['400', () => APIError.generate(400, {}, SENTINEL, new Headers()), 'provider-error', false],
    ['401', () => APIError.generate(401, {}, SENTINEL, new Headers()), 'provider-error', false],
    ['404', () => APIError.generate(404, {}, SENTINEL, new Headers()), 'provider-error', false],
    ['plain Error', () => new Error(SENTINEL), 'provider-error', false],
    ['thrown string', () => SENTINEL, 'provider-error', false],
  ];

  it.each(cases)('%s', async (_name, make, kind, retryable) => {
    expect(classifyError(make())).toEqual({ kind, retryable });
    const { client } = fakeClient(async () => {
      throw make();
    });
    const result = await makeOpenAiProvider({ client }).complete(makeRequest());
    expect(result).toEqual({ ok: false, error: { kind, retryable } });
  });

  it('never rejects when the client throws synchronously', async () => {
    const client: OpenAiClientLike = {
      chat: {
        completions: {
          create: () => {
            throw new Error(SENTINEL);
          },
        },
      },
    };
    const result = await makeOpenAiProvider({ client }).complete(makeRequest());
    expect(result).toEqual({ ok: false, error: { kind: 'provider-error', retryable: false } });
  });
});

describe('invalid responses', () => {
  const bad: readonly [string, ChatCompletionResult][] = [
    ['refusal', { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }] }],
    ['empty content', { choices: [{ finish_reason: 'stop', message: { content: '' } }] }],
    ['null content', { choices: [{ finish_reason: 'stop', message: { content: null } }] }],
    ['finish_reason length', { choices: [{ finish_reason: 'length', message: { content: '{"a":"x"}' } }] }],
    ['finish_reason content_filter', { choices: [{ finish_reason: 'content_filter', message: { content: '{"a":"x"}' } }] }],
    ['invalid JSON', { choices: [{ finish_reason: 'stop', message: { content: '{not json' } }] }],
    ['no choices', { choices: [] }],
    ['no message', { choices: [{ finish_reason: 'stop' }] }],
  ];

  it.each(bad)('%s gives invalid-response-shape, not retryable', async (_name, response) => {
    const { client } = fakeClient(async () => response);
    const result = await makeOpenAiProvider({ client }).complete(makeRequest());
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-response-shape', retryable: false } });
  });
});

describe('logging', () => {
  it('logs only content-free keys, for success and failure', async () => {
    const events: ProviderLogEvent[] = [];
    const logger = (e: ProviderLogEvent): void => {
      events.push(e);
    };
    let tick = 0;
    const now = (): number => (tick += 40);

    const ok = fakeClient(async () => okResponse());
    await makeOpenAiProvider({ client: ok.client, logger, now, apiKey: API_KEY }).complete(makeRequest());
    const failing = fakeClient(async () => {
      throw APIError.generate(500, { error: { message: SENTINEL } }, SENTINEL, new Headers());
    });
    await makeOpenAiProvider({ client: failing.client, logger, now, apiKey: API_KEY }).complete(makeRequest());

    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(Object.keys(e).sort()).toEqual(
        ['elapsedMs', 'inputTokens', 'modelId', 'outcome', 'outputTokens', 'stage'].sort(),
      );
    }
    expect(events[0]).toEqual({
      stage: 'generation',
      modelId: 'test-model',
      elapsedMs: 40,
      inputTokens: 11,
      outputTokens: 7,
      outcome: 'ok',
    });
    expect(events[1]?.outcome).toBe('provider-error');
    expect(events[1]?.inputTokens).toBe(0);

    const serialised = JSON.stringify(events);
    for (const secret of [SYSTEM_TEXT, USER_TEXT, ASSISTANT_TEXT, RESPONSE_TEXT, API_KEY, SENTINEL]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('survives a throwing logger', async () => {
    const { client } = fakeClient(async () => okResponse());
    const logger = vi.fn(() => {
      throw new Error('logger boom');
    });
    const result = await makeOpenAiProvider({ client, logger }).complete(makeRequest());
    expect(logger).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

describe('construction', () => {
  it('throws without a key or client, without echoing env values', () => {
    const env = { OTHER_SECRET: 'env-value-should-not-leak', OPENAI_API_KEY: '' };
    let message = '';
    try {
      makeOpenAiProvider({ env });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('env-value-should-not-leak');
    expect(() => makeOpenAiProvider({})).toThrow();
  });

  it('does not need a key when a client is injected', () => {
    const { client } = fakeClient(async () => okResponse());
    expect(() => makeOpenAiProvider({ client, env: {} })).not.toThrow();
  });

  it('reads the key from env exactly once, at construction', async () => {
    let reads = 0;
    const env = {
      get OPENAI_API_KEY(): string {
        reads += 1;
        return API_KEY;
      },
    };
    const provider = makeOpenAiProvider({ env });
    expect(reads).toBe(1);
    // The real SDK client would hit the stubbed fetch, which throws; complete() must still not reject.
    const result = await provider.complete({ ...makeRequest(), retryLimit: 0, timeoutMs: 1000 });
    expect(result.ok).toBe(false);
    expect(reads).toBe(1);
  });
});
