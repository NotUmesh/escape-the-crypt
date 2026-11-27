import { promptDigest } from '../provider/prompt-digest.js';
import type {
  Provider,
  ProviderErrorKind,
  ProviderRequest,
  ProviderResult,
} from '../provider/types.js';
import type { CassetteFile, CassetteProviderErrorKind } from './types.js';

const MISSING: CassetteProviderErrorKind = 'cassette-missing';

/**
 * The shared `Provider` interface stays provider-neutral and its `ProviderErrorKind` does not
 * list the cassette-only kind (design: production code has no branch for it). The cassette
 * provider is test-support, so it widens the kind at this single seam. Callers that care test
 * for it with `isCassetteMissing`.
 */
function missingFailure(): ProviderResult {
  const kind: string = MISSING;
  return {
    ok: false,
    error: { kind: kind as ProviderErrorKind, retryable: false },
  };
}

/** True when a result is the cassette-only `cassette-missing` failure. */
export function isCassetteMissing(result: ProviderResult): boolean {
  return !result.ok && (result.error.kind as string) === MISSING;
}

/** A Provider that replays entries by Prompt_Digest. Never calls a real endpoint, never throws. */
export function makeCassetteProvider(file: CassetteFile): Provider {
  const byDigest = new Map(file.entries.map((entry) => [entry.digest, entry] as const));
  return {
    complete(request: ProviderRequest): Promise<ProviderResult> {
      try {
        const entry = byDigest.get(promptDigest(request));
        return Promise.resolve(entry === undefined ? missingFailure() : entry.response);
      } catch {
        return Promise.resolve(missingFailure());
      }
    },
  };
}
