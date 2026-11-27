import type { CryptTarget } from '../run-length';
import type { ExtractedConcept } from './concept-extraction';
import type { PreparedDocument } from './prepare-input';

/** Where a concept sits in the notes: its earliest cited chunk, by code-assigned position. */
function positionOf(concept: ExtractedConcept, doc: PreparedDocument): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const id of concept.chunkIds) {
    const position = doc.chunks.get(id)?.position;
    if (position !== undefined && position < lowest) lowest = position;
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

/**
 * Keeps at most `max` concepts, spread over the whole document instead of taken from its start.
 * The chunk positions are cut into `max` equal bands; for each band, in order, the unused concept
 * nearest the band's centre is kept (ties go to the earlier concept). The kept concepts return in
 * their original order, with their original IDs. With `max` or fewer concepts nothing is dropped.
 * Pure and deterministic.
 */
export function selectSpreadConcepts(
  concepts: readonly ExtractedConcept[],
  max: number,
  doc: PreparedDocument,
): ExtractedConcept[] {
  if (max <= 0) return [];
  if (concepts.length <= max) return [...concepts];
  let span = 1;
  for (const chunk of doc.chunks.values()) span = Math.max(span, chunk.position + 1);
  const positions = concepts.map((c) => positionOf(c, doc));
  const kept = new Set<number>();
  for (let band = 0; band < max; band += 1) {
    const centre = ((band + 0.5) * span) / max;
    let best = -1;
    for (let i = 0; i < concepts.length; i += 1) {
      if (kept.has(i)) continue;
      const distance = Math.abs((positions[i] as number) - centre);
      if (best < 0 || distance < Math.abs((positions[best] as number) - centre)) best = i;
    }
    kept.add(best);
  }
  return concepts.filter((_, i) => kept.has(i));
}

/** The concepts a run generates for: all of them without a target, else the spread selection. */
export function conceptsForTarget(
  concepts: readonly ExtractedConcept[],
  target: CryptTarget | undefined,
  doc: PreparedDocument,
): ExtractedConcept[] {
  return target === undefined ? [...concepts] : selectSpreadConcepts(concepts, target.maxConcepts, doc);
}
