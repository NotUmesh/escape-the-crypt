import {
  z,
  type Provider,
  type ProviderErrorKind,
  type ProviderRequest,
  type ProviderResult,
  type ProviderUsage,
} from '@escape-the-crypt/core';
import { toGeminiJsonSchema } from './gemini-json-schema';
import type { ProviderLogEvent } from './openai-provider';

/**
 * Gemini over plain REST (`generateContent`, stable v1). No SDK: one POST per attempt.
 * `generateContent` keeps no conversation state on Google's side; the newer Interactions API
 * stores requests by default (`store=true`, 55 days on the paid tier), which our privacy rules
 * do not allow for learner notes.
 */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1';

/** A bare Gemini model ID such as `gemini-3.8-flash`. It goes into the URL path, so nothing else is allowed. */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
export function isGeminiModelId(value: string): boolean {
  return MODEL_ID.test(value);
}

/** Retry backoff, in line with the OpenAI SDK defaults the other provider uses. */
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 8_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiProviderConfig {
  readonly apiKey: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
  /** Receives one content-free event per call. */
  readonly logger?: (event: ProviderLogEvent) => void;
  /** Monotonic millisecond clock. */
  readonly now?: () => number;
  /** Waits between retries. Injected in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

// Only the fields we read. Unknown fields are allowed (and dropped) so new API fields never break parsing.
const UsageSchema = z.object({
  promptTokenCount: z.number().int().nonnegative().optional(),
  candidatesTokenCount: z.number().int().nonnegative().optional(),
  thoughtsTokenCount: z.number().int().nonnegative().optional(),
  toolUsePromptTokenCount: z.number().int().nonnegative().optional(),
});
const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional() })
          .optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: UsageSchema.optional(),
});
type GeminiResponse = z.infer<typeof ResponseSchema>;

type Attempt =
  | { readonly kind: 'reply'; readonly result: ProviderResult; readonly usage: ProviderUsage }
  | { readonly kind: 'failed'; readonly error: ProviderErrorKind; readonly retryable: boolean; readonly retryAfterMs: number | undefined };

/** HTTP status to typed error, matching `classifyError` in the OpenAI provider. */
export function classifyStatus(status: number): { kind: ProviderErrorKind; retryable: boolean } {
  if (status === 429) return { kind: 'rate-limited', retryable: true };
  return { kind: 'provider-error', retryable: status === 408 || status === 409 || status >= 500 };
}

/**
 * Usage for the budget. Thinking tokens are billed at the output rate and count against
 * `maxOutputTokens`, so they are added to output; tool-use prompt tokens are input.
 */
export function usageOf(meta: GeminiResponse['usageMetadata']): ProviderUsage {
  return {
    inputTokens: (meta?.promptTokenCount ?? 0) + (meta?.toolUsePromptTokenCount ?? 0),
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
  };
}

function invalid(): ProviderResult {
  return { ok: false, error: { kind: 'invalid-response-shape', retryable: false } };
}

/** A blocked prompt, a non-STOP finish (MAX_TOKENS, SAFETY, RECITATION ...), no text or bad JSON: not retryable. */
export function parseGeminiReply(raw: unknown): { result: ProviderResult; usage: ProviderUsage } {
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) return { result: invalid(), usage: { inputTokens: 0, outputTokens: 0 } };
  const usage = usageOf(parsed.data.usageMetadata);
  if (parsed.data.promptFeedback?.blockReason !== undefined) return { result: invalid(), usage };
  const candidate = parsed.data.candidates?.[0];
  if (candidate === undefined || candidate.finishReason !== 'STOP') return { result: invalid(), usage };
  const text = (candidate.content?.parts ?? [])
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (text.length === 0) return { result: invalid(), usage };
  try {
    const json: unknown = JSON.parse(text);
    return { result: { ok: true, json, usage }, usage };
  } catch {
    return { result: invalid(), usage };
  }
}

/** The request body. `assistant` turns are Gemini's `model` role. */
export function geminiBody(request: ProviderRequest): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      // Gemini documents temperature as ignored on Gemini 3.6 Flash and newer; it is sent anyway.
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      responseMimeType: 'application/json',
      responseJsonSchema: toGeminiJsonSchema(request.jsonSchema),
    },
  };
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 60 ? seconds * 1000 : undefined;
}

/**
 * Adapts Gemini `generateContent` to Core's `Provider`, with the OpenAI provider's contract:
 * per-attempt timeout `timeoutMs`, at most `retryLimit` retries of retryable failures (timeout,
 * 408, 409, 429, 5xx, network), typed errors, one content-free log event per call, never throws.
 * The key travels in the `x-goog-api-key` header, never in the URL. Error bodies are not read.
 */
export function makeGeminiProvider(config: GeminiProviderConfig): Provider {
  if (config.apiKey.trim().length === 0) throw new Error('GEMINI_API_KEY is not set');
  const apiKey = config.apiKey.trim();
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const baseUrl = config.baseUrl ?? GEMINI_BASE_URL;
  const now = config.now ?? (() => performance.now());
  const log = config.logger ?? (() => undefined);
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function attempt(request: ProviderRequest, body: string): Promise<Attempt> {
    if (!isGeminiModelId(request.modelId)) return { kind: 'failed', error: 'provider-error', retryable: false, retryAfterMs: undefined };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);
    try {
      const response = await doFetch(`${baseUrl}/models/${encodeURIComponent(request.modelId)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const { kind, retryable } = classifyStatus(response.status);
        return { kind: 'failed', error: kind, retryable, retryAfterMs: retryAfterMs(response) };
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        if (timedOut) return { kind: 'failed', error: 'timeout', retryable: true, retryAfterMs: undefined };
        return { kind: 'reply', result: invalid(), usage: { inputTokens: 0, outputTokens: 0 } };
      }
      const { result, usage } = parseGeminiReply(raw);
      return { kind: 'reply', result, usage };
    } catch {
      return timedOut
        ? { kind: 'failed', error: 'timeout', retryable: true, retryAfterMs: undefined }
        : { kind: 'failed', error: 'provider-error', retryable: true, retryAfterMs: undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async complete(request: ProviderRequest): Promise<ProviderResult> {
      const started = now();
      let usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
      let result: ProviderResult = { ok: false, error: { kind: 'provider-error', retryable: false } };
      try {
        const body = JSON.stringify(geminiBody(request));
        const retries = Math.max(0, Math.floor(request.retryLimit));
        for (let n = 0; n <= retries; n += 1) {
          const outcome = await attempt(request, body);
          if (outcome.kind === 'reply') {
            usage = outcome.usage;
            result = outcome.result;
            break;
          }
          result = { ok: false, error: { kind: outcome.error, retryable: outcome.retryable } };
          if (!outcome.retryable || n === retries) break;
          await sleep(outcome.retryAfterMs ?? Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** n));
        }
      } catch {
        result = { ok: false, error: { kind: 'provider-error', retryable: false } };
      }
      try {
        log({
          stage: request.stage,
          modelId: request.modelId,
          elapsedMs: Math.max(0, Math.round(now() - started)),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          outcome: result.ok ? 'ok' : result.error.kind,
        });
      } catch {
        // A failing logger must never break a call.
      }
      return result;
    },
  };
}
