import {
  promptDigest,
  type CassetteEntry,
  type CassetteFile,
  type Provider,
  type ProviderErrorKind,
  type ProviderRequest,
  type ProviderResult,
} from '@escape-the-crypt/core';

export interface RecordingCassette {
  /** Pass this to the pipeline. */
  readonly provider: Provider;
  /** Every entry this run used, recorded or replayed, in first-use order. */
  entries(): readonly CassetteEntry[];
  /** Entries newly recorded from the live provider in this run. */
  recorded(): readonly CassetteEntry[];
  liveCalls(): number;
  replayedCalls(): number;
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 } as const;
// The cassette-only kind, widened at this one seam exactly as core's cassette provider does.
const MISSING_KIND: string = 'cassette-missing';
const MISSING: ProviderResult = { ok: false, error: { kind: MISSING_KIND as ProviderErrorKind, retryable: false } };

/**
 * Replays a request from the cassette when its Prompt_Digest is there, else asks the live
 * provider and records a successful reply as a `recorded` entry (later identical requests in the
 * run replay it). With no live provider a miss is `cassette-missing` (replay only). A replayed
 * reply reports zero usage, so the budget ledger and the run's cost count only money spent in
 * this run; the cassette keeps the recorded usage. Failed live calls are not recorded. Never throws.
 */
export function makeRecordingCassette(existing: CassetteFile | null, live: Provider | null): RecordingCassette {
  const known = new Map((existing?.entries ?? []).map((e) => [e.digest, e] as const));
  const used = new Map<string, CassetteEntry>();
  const fresh: CassetteEntry[] = [];
  let liveCalls = 0;
  let replayedCalls = 0;
  const provider: Provider = {
    async complete(request: ProviderRequest): Promise<ProviderResult> {
      let digest: string;
      try {
        digest = promptDigest(request);
      } catch {
        return MISSING;
      }
      const hit = known.get(digest);
      if (hit !== undefined) {
        if (!used.has(digest)) used.set(digest, hit);
        replayedCalls += 1;
        return { ...hit.response, usage: ZERO_USAGE };
      }
      if (live === null) return MISSING;
      liveCalls += 1;
      let result: ProviderResult;
      try {
        result = await live.complete(request);
      } catch {
        result = { ok: false, error: { kind: 'provider-error', retryable: false } };
      }
      if (result.ok) {
        const entry: CassetteEntry = { digest, origin: 'recorded', response: result };
        fresh.push(entry);
        known.set(digest, entry);
        used.set(digest, entry);
      }
      return result;
    },
  };
  return {
    provider,
    entries: () => [...used.values()],
    recorded: () => [...fresh],
    liveCalls: () => liveCalls,
    replayedCalls: () => replayedCalls,
  };
}
