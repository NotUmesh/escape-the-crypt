import { describe, expect, it } from 'vitest';
import type {
  Provider,
  ProviderErrorKind,
  ProviderRequest,
  ProviderResult,
} from './types';

const ERROR_KINDS: readonly ProviderErrorKind[] = [
  'timeout',
  'rate-limited',
  'provider-error',
  'invalid-response-shape',
];

const request: ProviderRequest = {
  stage: 'generation',
  promptVersion: 'v1',
  modelId: 'fake-model',
  system: 'system',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0,
  maxOutputTokens: 100,
  jsonSchema: { type: 'object' },
  timeoutMs: 1000,
  retryLimit: 0,
};

/** Fake provider that returns a canned result per call and never throws. */
function fakeProvider(result: ProviderResult): Provider {
  return {
    complete(): Promise<ProviderResult> {
      return Promise.resolve(result);
    },
  };
}

describe('Provider interface (fake implementation)', () => {
  it('returns a success result with json and usage', async () => {
    const provider = fakeProvider({
      ok: true,
      json: { a: 1 },
      usage: { inputTokens: 3, outputTokens: 4 },
    });
    const result = await provider.complete(request);
    expect(result).toEqual({
      ok: true,
      json: { a: 1 },
      usage: { inputTokens: 3, outputTokens: 4 },
    });
  });

  it.each(ERROR_KINDS)('returns %s as a typed failure and does not throw', async (kind) => {
    for (const retryable of [true, false]) {
      const provider = fakeProvider({ ok: false, error: { kind, retryable } });
      const result = await provider.complete(request);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ kind, retryable });
      }
    }
  });

  it('covers every ProviderErrorKind with a failure that carries no message', async () => {
    const results = await Promise.all(
      ERROR_KINDS.map((kind) =>
        fakeProvider({ ok: false, error: { kind, retryable: false } }).complete(request),
      ),
    );
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.error).sort()).toEqual(['kind', 'retryable']);
    }
  });
});
