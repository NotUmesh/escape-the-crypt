import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai';
import type {
  Provider,
  ProviderErrorKind,
  ProviderRequest,
  ProviderResult,
} from '@escape-the-crypt/core';

/** Subset of the chat completions request this provider sends. */
export interface ChatCompletionParams {
  readonly model: string;
  readonly messages: readonly { readonly role: 'system' | 'user' | 'assistant'; readonly content: string }[];
  readonly temperature: number;
  readonly max_completion_tokens: number;
  readonly response_format: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: string;
      readonly strict: true;
      readonly schema: Readonly<Record<string, unknown>>;
    };
  };
}

export interface ChatCompletionRequestOptions {
  readonly timeout: number;
  readonly maxRetries: number;
}

/** Subset of the chat completion response this provider reads. */
export interface ChatCompletionResult {
  readonly choices: readonly {
    readonly finish_reason?: string | null;
    readonly message?: { readonly content?: string | null; readonly refusal?: string | null } | null;
  }[];
  readonly usage?: { readonly prompt_tokens: number; readonly completion_tokens: number } | null;
}

/** The only client surface the provider uses. Tests inject a fake of this shape. */
export interface OpenAiClientLike {
  readonly chat: {
    readonly completions: {
      create(
        body: ChatCompletionParams,
        options: ChatCompletionRequestOptions,
      ): Promise<ChatCompletionResult>;
    };
  };
}

export interface ProviderLogEvent {
  readonly stage: ProviderRequest['stage'];
  readonly modelId: string;
  readonly elapsedMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly outcome: 'ok' | ProviderErrorKind;
}

export interface OpenAiProviderConfig {
  /** Takes precedence over `env`. */
  readonly apiKey?: string;
  /** Read once at construction for OPENAI_API_KEY when `apiKey` is absent. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly baseUrl?: string;
  /** Injected client; when present, no key is needed. */
  readonly client?: OpenAiClientLike;
  /** Receives one content-free event per call. */
  readonly logger?: (event: ProviderLogEvent) => void;
  /** Monotonic millisecond clock. */
  readonly now?: () => number;
}

const MISSING_KEY_MESSAGE = 'OPENAI_API_KEY is not set';

export function sanitizeSchemaName(stage: string): string {
  const cleaned = stage.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'response';
}

export function classifyError(error: unknown): { kind: ProviderErrorKind; retryable: boolean } {
  if (error instanceof APIConnectionTimeoutError) return { kind: 'timeout', retryable: true };
  if (error instanceof RateLimitError) return { kind: 'rate-limited', retryable: true };
  if (error instanceof APIConnectionError) return { kind: 'provider-error', retryable: true };
  if (error instanceof APIError) {
    const status = error.status;
    return { kind: 'provider-error', retryable: status === 408 || status === 409 || (status !== undefined && status >= 500) };
  }
  return { kind: 'provider-error', retryable: false };
}

function failure(kind: ProviderErrorKind, retryable: boolean): ProviderResult {
  return { ok: false, error: { kind, retryable } };
}

function createRealClient(apiKey: string, baseUrl: string | undefined): OpenAiClientLike {
  const sdk = new OpenAI(baseUrl === undefined ? { apiKey } : { apiKey, baseURL: baseUrl });
  return {
    chat: {
      completions: {
        create: async (body, options) => {
          const response = await sdk.chat.completions.create(
            { ...body, messages: [...body.messages] },
            options,
          );
          return response;
        },
      },
    },
  };
}

/**
 * Adapts the OpenAI SDK to Core's `Provider`.
 * - `system` is sent as a `system` message (accepted by every chat model; the API maps it to
 *   developer instructions for reasoning models).
 * - Output is bounded with `max_completion_tokens` (`max_tokens` is deprecated in the SDK types).
 * - Timeout and retry limit are enforced by the SDK through per-request options.
 */
export function makeOpenAiProvider(config: OpenAiProviderConfig): Provider {
  let client = config.client;
  if (client === undefined) {
    const apiKey = config.apiKey ?? config.env?.['OPENAI_API_KEY'];
    if (apiKey === undefined || apiKey.length === 0) throw new Error(MISSING_KEY_MESSAGE);
    client = createRealClient(apiKey, config.baseUrl);
  }
  const sdkClient = client;
  const now = config.now ?? (() => performance.now());
  const log = config.logger ?? (() => undefined);

  return {
    async complete(request: ProviderRequest): Promise<ProviderResult> {
      const started = now();
      let inputTokens = 0;
      let outputTokens = 0;
      let result: ProviderResult;
      try {
        const response = await sdkClient.chat.completions.create(
          {
            model: request.modelId,
            messages: [{ role: 'system', content: request.system }, ...request.messages],
            temperature: request.temperature,
            max_completion_tokens: request.maxOutputTokens,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: sanitizeSchemaName(request.stage),
                strict: true,
                schema: request.jsonSchema,
              },
            },
          },
          { timeout: request.timeoutMs, maxRetries: request.retryLimit },
        );
        inputTokens = response.usage?.prompt_tokens ?? 0;
        outputTokens = response.usage?.completion_tokens ?? 0;
        result = parseResponse(response, inputTokens, outputTokens);
      } catch (error: unknown) {
        const { kind, retryable } = classifyError(error);
        result = failure(kind, retryable);
      }
      let elapsedMs = 0;
      try {
        elapsedMs = Math.max(0, Math.round(now() - started));
        log({
          stage: request.stage,
          modelId: request.modelId,
          elapsedMs,
          inputTokens,
          outputTokens,
          outcome: result.ok ? 'ok' : result.error.kind,
        });
      } catch {
        // A failing logger must never break a call.
      }
      return result;
    },
  };
}

function parseResponse(
  response: ChatCompletionResult,
  inputTokens: number,
  outputTokens: number,
): ProviderResult {
  const choice = response.choices[0];
  const message = choice?.message;
  if (choice === undefined || message === undefined || message === null) {
    return failure('invalid-response-shape', false);
  }
  if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') {
    return failure('invalid-response-shape', false);
  }
  if (typeof message.refusal === 'string' && message.refusal.length > 0) {
    return failure('invalid-response-shape', false);
  }
  if (typeof message.content !== 'string' || message.content.length === 0) {
    return failure('invalid-response-shape', false);
  }
  try {
    const json: unknown = JSON.parse(message.content);
    return { ok: true, json, usage: { inputTokens, outputTokens } };
  } catch {
    return failure('invalid-response-shape', false);
  }
}
