import { promptDigest } from '../provider/prompt-digest';
import type {
  Provider,
  ProviderRequest,
  ProviderResult,
  ProviderStage,
  ProviderUsage,
} from '../provider/types';

/** One Provider call. Digest, usage, time and stage only; never prompt or response text. */
export interface RecordedCall {
  readonly stage: ProviderStage;
  readonly promptDigest: string;
  readonly ok: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly elapsedMs: number;
}

export interface CallRecorder {
  /** Pass this to the stages in place of the real Provider. */
  readonly provider: Provider;
  /** Calls in the order they started. */
  calls(): readonly RecordedCall[];
  /** Sum of `costOf(usage)` over successful calls. */
  costUsd(): number;
}

const THROWN: ProviderResult = { ok: false, error: { kind: 'provider-error', retryable: false } };

/**
 * Decorates a Provider to record each call. The clock is injected; there is no `Date.now`.
 * A throwing inner Provider becomes a non-retryable `provider-error` failure, so this wrapper
 * never throws either.
 */
export function recordCalls(
  inner: Provider,
  now: () => number,
  costOf: (usage: ProviderUsage) => number,
): CallRecorder {
  const log: RecordedCall[] = [];
  let cost = 0;
  return {
    provider: {
      async complete(request: ProviderRequest): Promise<ProviderResult> {
        const started = now();
        const index = log.length;
        const digest = promptDigest(request);
        log.push({
          stage: request.stage,
          promptDigest: digest,
          ok: false,
          inputTokens: 0,
          outputTokens: 0,
          elapsedMs: 0,
        });
        let result: ProviderResult;
        try {
          result = await inner.complete(request);
        } catch {
          result = THROWN;
        }
        const usage = result.ok ? result.usage : { inputTokens: 0, outputTokens: 0 };
        if (result.ok) cost += costOf(result.usage);
        log[index] = {
          stage: request.stage,
          promptDigest: digest,
          ok: result.ok,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          elapsedMs: now() - started,
        };
        return result;
      },
    },
    calls: () => log.map((c) => ({ ...c })),
    costUsd: () => cost,
  };
}
