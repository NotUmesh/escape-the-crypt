import type { AuthoringQuestion } from '../authoring/schema';
import type { Result } from '../types';
import { generationOutcome, type OutcomeLog } from './candidate-outcomes';
import type { ConcurrencyOutcome } from './concurrency';
import type { ExtractedConcept } from './concept-extraction';
import type { GeneratedConceptQuestions } from './generation';
import type { PreparedDocument } from './prepare-input';
import type { PipelineRunCounts } from './run-metadata';
import type { PipelineStageError } from './stage-error';
import { conceptSourceWords } from './sufficiency';

export interface Candidate {
  readonly conceptIndex: number;
  readonly role: 'primary' | 'alternate';
  readonly question: AuthoringQuestion;
}

export type Slot<T> = { readonly skipped: true } | { readonly skipped: false; readonly value: T };
export const SKIPPED = { skipped: true } as const;

export type GenerationSlot = Slot<Result<GeneratedConceptQuestions | null, PipelineStageError>>;

const sourceWordsOf = (concept: ExtractedConcept | undefined, doc: PreparedDocument): number =>
  concept === undefined ? 0 : conceptSourceWords(concept, doc);

/**
 * Turns the generation results into the candidate list (primary, then alternate, per concept in
 * extraction order) and records one generation outcome per concept. Moved out of the orchestrator
 * unchanged.
 */
export function collectCandidates(
  generated: ReadonlyArray<ConcurrencyOutcome<GenerationSlot>>,
  concepts: readonly ExtractedConcept[],
  doc: PreparedDocument,
  counts: PipelineRunCounts,
  outcomes: OutcomeLog,
): Candidate[] {
  const candidates: Candidate[] = [];
  generated.forEach((outcome, conceptIndex) => {
    const slot = outcome.ok ? outcome.value : SKIPPED;
    outcomes.concepts.push({
      conceptIndex,
      conceptId: concepts[conceptIndex]?.conceptId ?? '',
      generation: generationOutcome(slot),
      sourceWords: sourceWordsOf(concepts[conceptIndex], doc),
    });
    if (slot.skipped || !slot.value.ok) {
      if (!slot.skipped && !slot.value.ok && slot.value.error.kind === 'schema-rejected') {
        counts.schemaRejected += 1;
      }
      counts.conceptsSetAside += 1;
      return;
    }
    const pair = slot.value.value;
    if (pair === null) return; // the model chose no lock: not a failure
    candidates.push({ conceptIndex, role: 'primary', question: pair.primary });
    if (pair.alternate !== null) {
      candidates.push({ conceptIndex, role: 'alternate', question: pair.alternate });
    }
  });
  counts.candidates = candidates.length;
  return candidates;
}
