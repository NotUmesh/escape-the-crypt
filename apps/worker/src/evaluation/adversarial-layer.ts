import type { CandidateOutcomeSchema } from './result-file';
import type { z } from '@escape-the-crypt/core';

/** The layer that rejected a question, or `none` when nothing did. */
export type RejectingLayer = 'code' | 'review' | 'conflict-check' | 'none';

type CandidateResult = z.infer<typeof CandidateOutcomeSchema>['result'];

export function layerOfResult(result: CandidateResult): RejectingLayer {
  switch (result) {
    case 'code-check-rejected':
      return 'code';
    case 'review-rejected':
      return 'review';
    case 'conflict-rejected':
      return 'conflict-check';
    default:
      return 'none';
  }
}

/** The layer a fixture's `expectedCatch` names (`code:*`, `review:*`, `pipeline:conflict-check`); null for anything else. */
export function expectedLayerOf(expectedCatch: string): RejectingLayer | null {
  if (expectedCatch.startsWith('code:')) return 'code';
  if (expectedCatch.startsWith('review:')) return 'review';
  if (expectedCatch === 'pipeline:conflict-check') return 'conflict-check';
  return null;
}

/** A fixture counts as rejected by its expected layer only when that very layer rejected it. */
export function rejectedByExpectedLayer(expectedCatch: string, rejectedBy: RejectingLayer): boolean {
  const expected = expectedLayerOf(expectedCatch);
  return expected !== null && expected === rejectedBy;
}
