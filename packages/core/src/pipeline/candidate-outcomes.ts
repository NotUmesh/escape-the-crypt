import type { LockType } from '../types';
import type { ReviewRejection } from './blind-review';
import type { RoomAssembly } from './room-assembly';
import type { PipelineStageError } from './stage-error';

/**
 * Per-concept and per-question outcomes of one run, for evaluation reports. Closed-set names,
 * indexes and code-assigned IDs only: no notes text, prompt, model output or question text.
 */

/** What generation returned for one concept. */
export type GenerationOutcome = 'questions' | 'no-lock' | 'skipped' | PipelineStageError['kind'];

export interface ConceptGenerationOutcome {
  readonly conceptIndex: number;
  readonly conceptId: string;
  readonly generation: GenerationOutcome;
  /** Words in the concept's distinct cited chunks (a count; no text). */
  readonly sourceWords: number;
}

export type CandidateResult =
  | 'accepted'
  | 'code-check-rejected'
  | 'review-rejected'
  | 'not-reviewed'
  | 'conflict-rejected';

/** Where an accepted question ended up after room assembly; null for a rejected question. */
export type Placement =
  | 'slot-lead'
  | 'slot-alternate'
  | 'mapper-rejected'
  | 'duplicate-skipped'
  | 'leak-dropped'
  | 'unplaced'
  | 'not-placed';

export interface CandidateOutcome {
  readonly conceptIndex: number;
  readonly conceptId: string;
  readonly role: 'primary' | 'alternate';
  readonly lockType: LockType;
  readonly result: CandidateResult;
  /** Blocking Check_IDs, sorted; empty unless result is code-check-rejected. */
  readonly checkIds: readonly string[];
  /** The blind review rejection kind; null unless result is review-rejected. */
  readonly reviewReason: ReviewRejection['kind'] | null;
  /** Why the mapper refused an accepted question: its error kind, or `check-failed:<Check_ID>`. */
  readonly mapperReason: string | null;
  readonly placement: Placement | null;
}

export interface RunOutcomes {
  readonly concepts: readonly ConceptGenerationOutcome[];
  readonly candidates: readonly CandidateOutcome[];
}

/** Mutable accumulator the orchestrator fills; `snapshot` copies it. */
export interface OutcomeLog {
  readonly concepts: ConceptGenerationOutcome[];
  readonly candidates: CandidateOutcome[];
}

export const newOutcomeLog = (): OutcomeLog => ({ concepts: [], candidates: [] });

export function snapshotOutcomes(log: OutcomeLog): RunOutcomes {
  return {
    concepts: log.concepts.map((c) => ({ ...c })),
    candidates: log.candidates.map((c) => ({ ...c, checkIds: [...c.checkIds] })),
  };
}

/** Sets `placement` on every accepted candidate from the assembly result. */
export function recordPlacements(log: OutcomeLog, assembly: RoomAssembly): void {
  const ids = (conceptId: string, role: string): string => `${conceptId}-${role}`;
  const leads = new Set<string>();
  const alternates = new Set<string>();
  for (const slot of assembly.manifest.rooms.flatMap((r) => r.lockSlots)) {
    leads.add(slot.primaryQuestion.questionId);
    if (slot.alternateQuestion !== null) alternates.add(slot.alternateQuestion.questionId);
  }
  const mapper = new Map(
    assembly.mapperRejections.map((r) => [
      ids(r.conceptId, r.role),
      r.error.kind === 'check-failed' ? `check-failed:${r.error.checkId}` : r.error.kind,
    ]),
  );
  const duplicate = new Set(assembly.duplicateSkipped.map((d) => ids(d.conceptId, d.role)));
  const leakDropped = new Set(assembly.leakDroppedConceptIds);
  const unplaced = new Set(assembly.unplacedAccepted.map((u) => u.question.questionId));
  log.candidates.forEach((c, i) => {
    if (c.result !== 'accepted') return;
    const id = ids(c.conceptId, c.role);
    const placement: Placement = leads.has(id)
      ? 'slot-lead'
      : alternates.has(id)
        ? 'slot-alternate'
        : mapper.has(id)
          ? 'mapper-rejected'
          : duplicate.has(id)
            ? 'duplicate-skipped'
            : leakDropped.has(c.conceptId)
              ? 'leak-dropped'
              : unplaced.has(id)
                ? 'unplaced'
                : 'not-placed';
    log.candidates[i] = { ...c, placement, mapperReason: mapper.get(id) ?? null };
  });
}

/** A concept's generation outcome from its task slot. */
export function generationOutcome(
  slot:
    | { readonly skipped: true }
    | {
        readonly skipped: false;
        readonly value:
          | { readonly ok: true; readonly value: unknown }
          | { readonly ok: false; readonly error: { readonly kind: PipelineStageError['kind'] } };
      },
): GenerationOutcome {
  if (slot.skipped) return 'skipped';
  if (!slot.value.ok) return slot.value.error.kind;
  return slot.value.value === null ? 'no-lock' : 'questions';
}

/** Marks a reviewed question accepted or review-rejected. A missing verdict counts as provider-failed. */
export function recordVerdict(
  log: OutcomeLog,
  c: { readonly conceptIndex: number; readonly role: 'primary' | 'alternate' },
  verdict: { readonly verdict: 'passed' } | { readonly verdict: 'rejected'; readonly reason: ReviewRejection } | null,
): void {
  const at = log.candidates.findIndex((o) => o.conceptIndex === c.conceptIndex && o.role === c.role);
  const entry = log.candidates[at];
  if (entry === undefined) return;
  log.candidates[at] =
    verdict?.verdict === 'passed'
      ? { ...entry, result: 'accepted' }
      : { ...entry, result: 'review-rejected', reviewReason: verdict?.reason.kind ?? 'provider-failed' };
}
