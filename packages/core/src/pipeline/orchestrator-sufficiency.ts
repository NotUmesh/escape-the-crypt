import type { CryptTarget } from '../run-length';
import type { ExtractedConcept } from './concept-extraction';
import { conceptsForTarget } from './concept-spread';
import type { PipelineNotices } from './pipeline-notices';
import type { PreparedDocument } from './prepare-input';
import type { PipelineRunCounts } from './run-metadata';
import { sufficiencyNotice, splitThinConcepts } from './sufficiency';

export interface ConceptSelection {
  /** The concepts the run generates for, in extraction order. */
  readonly concepts: readonly ExtractedConcept[];
  /** Concepts the cap could choose from: all extracted with the option off, else the kept ones. */
  readonly candidates: number;
  /** Set when the run must end before any generation call: concepts with enough source text. */
  readonly insufficient: { readonly found: number } | null;
}

/**
 * Picks the concepts a run generates for. With `sufficiency` off this is exactly the capped spread
 * selection of before. With it on, concepts citing too little source text are removed first (and
 * counted in `conceptsTooThin`), so a thin concept never takes a `maxConcepts` slot; with a target,
 * fewer kept concepts than `locksPerRoom` stops the run. Without a target there is no early stop.
 */
export function selectRunConcepts(
  extracted: readonly ExtractedConcept[],
  doc: PreparedDocument,
  target: CryptTarget | undefined,
  sufficiency: boolean | undefined,
  counts: PipelineRunCounts,
): ConceptSelection {
  if (sufficiency !== true) {
    return { concepts: conceptsForTarget(extracted, target, doc), candidates: extracted.length, insufficient: null };
  }
  const { kept, thin } = splitThinConcepts(extracted, doc);
  counts.conceptsTooThin = thin.length;
  const insufficient = target !== undefined && kept.length < target.locksPerRoom ? { found: kept.length } : null;
  return { concepts: conceptsForTarget(kept, target, doc), candidates: kept.length, insufficient };
}

/**
 * Adds `notices.sufficiency` when fewer rooms were built than the target asked for. Does nothing
 * with the option off. Returns the notices unchanged when there is nothing to add.
 */
export function withSufficiencyNotice(
  notices: PipelineNotices | undefined,
  sufficiency: boolean | undefined,
  target: CryptTarget | undefined,
  goodConcepts: number,
  builtRooms: number,
): PipelineNotices | undefined {
  if (sufficiency !== true) return notices;
  const notice = sufficiencyNotice(goodConcepts, target, builtRooms);
  if (notice === undefined) return notices;
  return { excluded: notices?.excluded ?? [], sufficiency: notice };
}
