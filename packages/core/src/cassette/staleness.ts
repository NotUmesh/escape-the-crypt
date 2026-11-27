import { promptDigest } from '../provider/prompt-digest.js';
import type { ProviderRequest } from '../provider/types.js';
import type { CassetteFile } from './types.js';

/** True when no entry in the file matches the request's Prompt_Digest. */
export function isCassetteStale(file: CassetteFile, request: ProviderRequest): boolean {
  const digest = promptDigest(request);
  return !file.entries.some((entry) => entry.digest === digest);
}
