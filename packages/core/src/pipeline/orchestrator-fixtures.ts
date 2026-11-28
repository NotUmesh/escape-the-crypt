import { makeMockLedger, type MockLedger } from '../budget/mock-ledger';
import type { Provider, ProviderRequest, ProviderResult, ProviderStage } from '../provider/types';
import type { PipelineOptions } from './orchestrator';

/** One handler per stage. Returns the JSON the model would return, or a full failure result. */
export type StageHandler = (request: ProviderRequest) => unknown;

export type StageHandlers = Readonly<
  Record<Exclude<ProviderStage, 'conflict-check'>, StageHandler> & { 'conflict-check'?: StageHandler }
>;

export interface ScriptedProvider extends Provider {
  readonly requests: ProviderRequest[];
}

const USAGE = { inputTokens: 10, outputTokens: 5 };

function isProviderResult(value: unknown): value is ProviderResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof (value as { ok: unknown }).ok === 'boolean' &&
    ((value as { ok: boolean }).ok ? 'json' in value && 'usage' in value : 'error' in value)
  );
}

/**
 * A fake Provider that dispatches on `request.stage`. Handlers see the real request, so they can
 * read the concept label or the question prompt from the user message. No cassette and no digest:
 * suitable for randomly generated inputs. Never throws; a throwing handler becomes a provider error.
 */
export function makeScriptedProvider(handlers: StageHandlers): ScriptedProvider {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    async complete(request): Promise<ProviderResult> {
      requests.push(request);
      try {
        const handler = handlers[request.stage];
        if (handler === undefined) {
          return { ok: false, error: { kind: 'provider-error', retryable: false } };
        }
        const out = handler(request);
        if (isProviderResult(out)) return out;
        return { ok: true, json: out, usage: USAGE };
      } catch {
        return { ok: false, error: { kind: 'provider-error', retryable: false } };
      }
    },
  };
}

/** The text of the first user message of a request. */
export function userMessageOf(request: ProviderRequest): string {
  return request.messages.find((m) => m.role === 'user')?.content ?? '';
}

/** Pipeline options with injected, deterministic values and room for every call the run makes. */
export function makePipelineOptions(
  provider: Provider,
  ledger: MockLedger = makeLargeLedger(),
  over: Partial<PipelineOptions> = {},
): PipelineOptions {
  return {
    provider,
    ledger,
    providerName: 'scripted',
    concurrency: 4,
    now: () => 0,
    modelId: 'test-model',
    temperature: 0,
    maxOutputTokens: 1000,
    timeoutMs: 5000,
    retryLimit: 0,
    worstCaseUsd: 0.001,
    costOf: () => 0.0005,
    ...over,
  };
}

export function makeLargeLedger(): MockLedger {
  return makeMockLedger({ dailyCapUsd: 1_000_000 });
}
