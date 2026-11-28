export type ProviderStage = 'concept-extraction' | 'generation' | 'review' | 'conflict-check';

export interface ProviderRequest {
  readonly stage: ProviderStage;
  /** Bumped whenever a prompt template's wording changes. */
  readonly promptVersion: string;
  readonly modelId: string;
  readonly system: string;
  readonly messages: readonly {
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }[];
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** JSON schema the response must satisfy. Provider-neutral: a plain JSON Schema object, not an SDK type. */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly retryLimit: number;
}

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderSuccess {
  readonly ok: true;
  /** Caller validates with Zod; the Provider never validates against the request schema itself. */
  readonly json: unknown;
  readonly usage: ProviderUsage;
}

export type ProviderErrorKind =
  | 'timeout'
  | 'rate-limited'
  | 'provider-error'
  | 'invalid-response-shape';

export interface ProviderFailure {
  readonly ok: false;
  readonly error: {
    readonly kind: ProviderErrorKind;
    readonly retryable: boolean;
  };
}

export type ProviderResult = ProviderSuccess | ProviderFailure;

/**
 * One call-through interface for every model call. No OpenAI (or any SDK) type appears here or
 * anywhere else in Core; `apps/worker` adapts the OpenAI client to this shape. Implementations
 * must enforce `timeoutMs`, `maxOutputTokens` and `retryLimit` themselves and must never throw;
 * every failure path returns a `ProviderFailure`.
 */
export interface Provider {
  complete(request: ProviderRequest): Promise<ProviderResult>;
}
