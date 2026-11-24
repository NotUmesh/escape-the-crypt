import type { LockSlotSpec, QuestionSpec } from './manifest-types';
import type { ConceptRecord, GhostState } from './state-types';

/** Judged answers that must pass after a ghost spawns before it returns (Req 15.1). */
export const GHOST_DELAY = 3;

/** A concept returns at most twice (Req 14.8). */
export const MAX_RETURN_NUMBER = 2;

export type SpawnGhostError =
  | { readonly kind: 'ghost-already-pending'; readonly conceptId: string }
  | { readonly kind: 'return-cap-exceeded'; readonly conceptId: string };

export type SpawnGhostResult =
  | { readonly ok: true; readonly ghosts: readonly GhostState[] }
  | { readonly ok: false; readonly error: SpawnGhostError };

/**
 * Add a pending ghost, recording the judged-answer count at this moment (Req 15.2).
 * Refuses a second pending ghost for the same concept (Req 14.7) and a return number
 * above 2 (Req 14.8). The input list is never changed.
 */
export function spawnGhost(
  ghosts: readonly GhostState[],
  conceptId: string,
  returnNumber: number,
  judgedAnswerCount: number,
): SpawnGhostResult {
  if (returnNumber !== 1 && returnNumber !== 2) {
    return { ok: false, error: { kind: 'return-cap-exceeded', conceptId } };
  }
  if (ghosts.some((g) => g.conceptId === conceptId)) {
    return { ok: false, error: { kind: 'ghost-already-pending', conceptId } };
  }
  const ghost: GhostState = {
    conceptId,
    returnNumber,
    judgedAnswerCountAtSpawn: judgedAnswerCount,
    due: false,
  };
  return { ok: true, ghosts: [...ghosts, ghost] };
}

/** A ghost is due once enough judged answers have passed since it spawned (Req 15.3). */
export function isGhostDue(ghost: GhostState, judgedAnswerCount: number): boolean {
  return judgedAnswerCount - ghost.judgedAnswerCountAtSpawn >= GHOST_DELAY;
}

export interface GhostPartition {
  /** Due ghosts, marked `due: true`, in queue order. */
  readonly due: readonly GhostState[];
  /** Not-yet-due ghosts, returned unchanged so they carry into the next room (Req 15.5). */
  readonly pending: readonly GhostState[];
}

/** Split the queue by the due rule. Only judged answers move the count (Req 15.4). */
export function partitionGhosts(
  ghosts: readonly GhostState[],
  judgedAnswerCount: number,
): GhostPartition {
  const due: GhostState[] = [];
  const pending: GhostState[] = [];
  for (const ghost of ghosts) {
    if (isGhostDue(ghost, judgedAnswerCount)) due.push({ ...ghost, due: true });
    else pending.push(ghost);
  }
  return { due, pending };
}

/** Append a question ID to the concept's show history when it is not already there. */
export function recordQuestionShown(record: ConceptRecord, questionId: string): ConceptRecord {
  if (record.shownQuestionIds.includes(questionId)) return record;
  return { ...record, shownQuestionIds: [...record.shownQuestionIds, questionId] };
}

export interface ReturnQuestionChoice {
  readonly question: QuestionSpec;
  /** 'review' iff the question was already shown for this concept (Req 14.9, 14.10). */
  readonly label: 'review' | null;
  /** The concept record with the question appended to its show history. */
  readonly record: ConceptRecord;
}

export type ChooseReturnResult =
  | { readonly ok: true; readonly choice: ReturnQuestionChoice }
  | {
      readonly ok: false;
      readonly error: { readonly kind: 'no-eligible-question'; readonly conceptId: string };
    };

/**
 * Pick the question for a Return_Slot. Return 1 uses the unused Alternate, otherwise
 * the primary (Req 14.2, 14.3). Return 2 uses the primary (Req 14.4). A question whose
 * result is 'challenged' is never chosen (Req 14.11); then the result is a typed
 * "no eligible question".
 */
export function chooseReturnQuestion(
  spec: LockSlotSpec,
  record: ConceptRecord,
  returnNumber: 1 | 2,
): ChooseReturnResult {
  const alternate = spec.alternateQuestion;
  const useAlternate = returnNumber === 1 && alternate !== null && !record.alternateUsed;
  const question = useAlternate && alternate !== null ? alternate : spec.primaryQuestion;
  const priorResult = useAlternate ? record.alternateResult : record.firstQuestionResult;
  if (priorResult === 'challenged') {
    return { ok: false, error: { kind: 'no-eligible-question', conceptId: record.conceptId } };
  }
  const label = record.shownQuestionIds.includes(question.questionId) ? 'review' : null;
  const shown = recordQuestionShown(record, question.questionId);
  return {
    ok: true,
    choice: { question, label, record: useAlternate ? { ...shown, alternateUsed: true } : shown },
  };
}

/** True when a Return of this number would have an unchallenged question to show. */
export function hasEligibleReturnQuestion(
  spec: LockSlotSpec | null,
  record: ConceptRecord,
  returnNumber: 1 | 2,
): boolean {
  return spec !== null && chooseReturnQuestion(spec, record, returnNumber).ok;
}
