import type { AuthoringQuestion } from '../authoring/schema';
import type { ReviewVerdict } from './blind-review';
import { recordVerdict, type OutcomeLog } from './candidate-outcomes';
import type { StageCandidate } from './code-check-stage';
import type { ConcurrencyOutcome } from './concurrency';
import type { PipelineRunCounts } from './run-metadata';

type Slot<T> = { readonly skipped: true } | { readonly skipped: false; readonly value: T };

/**
 * Folds the blind-review verdicts into the accepted questions per concept (`[primary, alternate]`)
 * and the run counts. A skipped task adds nothing. A budget stop, a code defect or a cancel is not
 * a judgement on the question, so it is neither accepted nor counted as rejected. Moved out of the
 * orchestrator unchanged.
 */
export function tallyReviews(
  survivors: readonly StageCandidate[],
  reviewed: readonly (ConcurrencyOutcome<Slot<ReviewVerdict>> | undefined)[],
  conceptCount: number,
  counts: PipelineRunCounts,
  outcomes: OutcomeLog,
): (AuthoringQuestion | null)[][] {
  const accepted: (AuthoringQuestion | null)[][] = Array.from({ length: conceptCount }, () => [null, null]);
  survivors.forEach((c, i) => {
    const outcome = reviewed[i];
    if (outcome === undefined || (outcome.ok && outcome.value.skipped)) return;
    // A task that rejected despite the never-throws contract sets only its question aside.
    const verdict: ReviewVerdict | null = outcome.ok && !outcome.value.skipped ? outcome.value.value : null;
    recordVerdict(outcomes, c, verdict);
    if (verdict?.verdict === 'passed') {
      counts.accepted += 1;
      const row = accepted[c.conceptIndex];
      if (row !== undefined) row[c.role === 'primary' ? 0 : 1] = c.question;
      return;
    }
    if (verdict?.verdict === 'rejected') {
      const kind = verdict.reason.kind;
      if (kind === 'budget-exhausted' || kind === 'schema-not-representable' || kind === 'cancelled') {
        return;
      }
      if (kind === 'schema-rejected') counts.schemaRejected += 1;
    }
    counts.reviewRejections += 1;
    counts.discarded += 1;
  });
  return accepted;
}
