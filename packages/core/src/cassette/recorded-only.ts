import type { Result } from '../types.js';
import type { CassetteEntry } from './types.js';

export type SyntheticCassetteInEvaluationError = {
  readonly kind: 'synthetic-cassette-in-evaluation';
  /** Digests of the synthetic entries, in input order, de-duplicated. */
  readonly digests: readonly string[];
};

/**
 * Guard that keeps synthetic cassette entries out of evaluation results (Req 12.10, 21.3).
 *
 * P4 seam: the P4 evaluation results writer must call this on every cassette
 * entry behind a run before it writes any result file or counts any metric
 * (Requirement 12.10), and must abort the write when it returns an error.
 *
 * Empty input returns `ok` (every entry is vacuously recorded). A run with no
 * cassette entries has no synthetic data to exclude; whether an empty run is
 * worth reporting is the caller's decision, not this guard's.
 *
 * Pure; never throws.
 */
export function assertRecordedOnly(
  entries: readonly Pick<CassetteEntry, 'digest' | 'origin'>[],
): Result<void, SyntheticCassetteInEvaluationError> {
  const digests: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.origin === 'synthetic' && !seen.has(entry.digest)) {
      seen.add(entry.digest);
      digests.push(entry.digest);
    }
  }
  if (digests.length > 0) {
    return { ok: false, error: { kind: 'synthetic-cassette-in-evaluation', digests } };
  }
  return { ok: true, value: undefined };
}
