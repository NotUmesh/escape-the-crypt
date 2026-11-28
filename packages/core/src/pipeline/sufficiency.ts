import { countWords } from '../limits';
import type { CryptTarget } from '../run-length';
import type { ExtractedConcept } from './concept-extraction';
import type { PreparedDocument } from './prepare-input';

/**
 * A concept whose cited chunks hold fewer words than this is too thin to ask about.
 * Provisional (Open decision D8): below the smallest gold value, so it rejects none of the dev
 * gold concepts. The sufficiency evaluation may lower it.
 */
export const MIN_CONCEPT_SOURCE_WORDS = 12;

/** Why a crypt has fewer rooms than asked for. Counts only: no notes, no model output. */
export interface SufficiencyNotice {
  /** Concepts that were not too thin to ask about. */
  readonly goodConcepts: number;
  /** Concepts the requested crypt size needs. */
  readonly conceptsNeeded: number;
  readonly requestedRooms: number;
  readonly builtRooms: number;
}

/** Words in the concept's distinct cited chunks, each chunk counted once. Unknown IDs count 0. */
export function conceptSourceWords(concept: ExtractedConcept, doc: PreparedDocument): number {
  let total = 0;
  for (const id of new Set(concept.chunkIds)) {
    const chunk = doc.chunks.get(id);
    if (chunk !== undefined) total += countWords(chunk.text);
  }
  return total;
}

/** Splits concepts into kept and thin, each in input order. Concept IDs are unchanged. */
export function splitThinConcepts(
  concepts: readonly ExtractedConcept[],
  doc: PreparedDocument,
): { readonly kept: ExtractedConcept[]; readonly thin: ExtractedConcept[] } {
  const kept: ExtractedConcept[] = [];
  const thin: ExtractedConcept[] = [];
  for (const concept of concepts) {
    (conceptSourceWords(concept, doc) >= MIN_CONCEPT_SOURCE_WORDS ? kept : thin).push(concept);
  }
  return { kept, thin };
}

/** Concepts the crypt size needs: one per lock. */
export function conceptsNeeded(target: CryptTarget): number {
  return target.rooms * target.locksPerRoom;
}

/** A notice exactly when a target is present and fewer rooms were built than it asked for. */
export function sufficiencyNotice(
  goodConcepts: number,
  target: CryptTarget | undefined,
  builtRooms: number,
): SufficiencyNotice | undefined {
  if (target === undefined || builtRooms >= target.rooms) return undefined;
  return {
    goodConcepts,
    conceptsNeeded: conceptsNeeded(target),
    requestedRooms: target.rooms,
    builtRooms,
  };
}
