import type { AuthoringQuestion } from '../authoring/schema';
import { CHECK_REGISTRY } from '../checks/registry';
import { runChecks } from '../checks/run-checks';
import type { OutcomeLog } from './candidate-outcomes';
import { toEvidenceContext, type PreparedDocument } from './prepare-input';
import type { PipelineRunCounts } from './run-metadata';

const BLOCKING_IDS: ReadonlySet<string> = new Set(
  CHECK_REGISTRY.filter((r) => r.severity !== 'advisory').map((r) => r.id),
);

export interface StageCandidate {
  readonly conceptIndex: number;
  readonly role: 'primary' | 'alternate';
  readonly question: AuthoringQuestion;
}

/**
 * Code_Checks, once per question; siblings are the other question of the same concept. Returns
 * the questions with no blocking failure. Counts each blocking Check_ID once per question and logs
 * one outcome per question (lock type, role, sorted Check_IDs). Pure apart from the accumulators.
 */
export function runCodeCheckStage<C extends StageCandidate>(
  candidates: readonly C[],
  doc: PreparedDocument,
  conceptIdOf: (conceptIndex: number) => string,
  counts: PipelineRunCounts,
  log: OutcomeLog,
): C[] {
  const evidence = toEvidenceContext(doc);
  return candidates.filter((c) => {
    const siblings = candidates
      .filter((o) => o.conceptIndex === c.conceptIndex && o !== c)
      .map((o) => o.question);
    const ids = new Set(
      runChecks({ question: c.question, siblings, ...evidence })
        .filter((f) => BLOCKING_IDS.has(f.checkId))
        .map((f) => f.checkId),
    );
    log.candidates.push({
      conceptIndex: c.conceptIndex,
      conceptId: conceptIdOf(c.conceptIndex),
      role: c.role,
      lockType: c.question.lockType,
      result: ids.size === 0 ? 'not-reviewed' : 'code-check-rejected',
      checkIds: [...ids].sort(),
      reviewReason: null,
      mapperReason: null,
      placement: null,
    });
    if (ids.size === 0) return true;
    for (const id of ids) counts.codeCheckRejections[id] = (counts.codeCheckRejections[id] ?? 0) + 1;
    counts.discarded += 1;
    return false;
  });
}
