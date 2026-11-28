import type { ProviderStage } from '../provider/types';

/**
 * Typed error shared by pipeline stages. Carries kinds and stage names only: never notes text,
 * prompt text, model output or Zod issue contents (Req 11.7).
 */
export type PipelineStageError =
  | { readonly kind: 'provider-failed'; readonly stage: ProviderStage; readonly retryable: boolean }
  | { readonly kind: 'schema-invalid'; readonly stage: ProviderStage }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'pipeline-unknown-chunk'; readonly chunkId: string }
  /** The document is above the 6,000-word cap; no call was made (Req 13.7). */
  | { readonly kind: 'input-too-long'; readonly limit: number }
  /** A question was set aside after its schema failed twice (generation, Req 14.8). */
  | { readonly kind: 'schema-rejected'; readonly stage: ProviderStage }
  /** The model proposed a primary lock type the caller did not allow (Req 14.9). */
  | { readonly kind: 'lock-type-not-allowed' }
  /** The model-facing JSON schema could not be built. A code defect, not a model failure. */
  | { readonly kind: 'schema-not-representable'; readonly stage: ProviderStage }
  /** The caller's signal was aborted before a reservation or call could start. */
  | { readonly kind: 'cancelled' }
  /** Every room the conflict check attempted failed, so nothing could be checked clean. */
  | { readonly kind: 'conflict-check-failed' }
  /** Too few concepts with enough source text to build a crypt of the requested size. */
  | { readonly kind: 'insufficient-concepts'; readonly found: number };
