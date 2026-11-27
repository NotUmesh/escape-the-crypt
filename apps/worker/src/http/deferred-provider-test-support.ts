import type { Provider, ProviderResult, ProviderStage } from '@escape-the-crypt/core';

const USAGE = { inputTokens: 100, outputTokens: 50 };

export interface DeferredScriptedProvider extends Provider {
  /** Stage of every call, in start order. */
  readonly started: readonly ProviderStage[];
  /** Calls started and not yet settled. */
  readonly pending: number;
  /** Settles every in-flight call with its scripted answer. Calls started later stay in flight. */
  settleAll(): number;
  /** Settles the oldest in-flight call. False when nothing is in flight. */
  settleNext(): boolean;
}

/**
 * A small scripted provider. Each call stays in flight until the test settles it.
 * Extraction gets `extractionJson`; every other stage gets a well-formed success that fails
 * the stage's schema (so the call is paid for and reconciled, and the question is set aside).
 */
export function makeDeferredScriptedProvider(extractionJson: unknown): DeferredScriptedProvider {
  const started: ProviderStage[] = [];
  const queue: { stage: ProviderStage; resolve: (r: ProviderResult) => void }[] = [];
  const answer = (stage: ProviderStage): ProviderResult => ({
    ok: true,
    json: stage === 'concept-extraction' ? extractionJson : { unexpected: true },
    usage: USAGE,
  });
  const settle = (): boolean => {
    const entry = queue.shift();
    if (entry === undefined) return false;
    entry.resolve(answer(entry.stage));
    return true;
  };
  return {
    started,
    get pending() {
      return queue.length;
    },
    complete(request) {
      started.push(request.stage);
      return new Promise<ProviderResult>((resolve) => queue.push({ stage: request.stage, resolve }));
    },
    settleAll() {
      let n = 0;
      while (settle()) n += 1;
      return n;
    },
    settleNext: settle,
  };
}
