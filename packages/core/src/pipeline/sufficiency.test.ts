import { describe, expect, it } from 'vitest';
import { cryptTargetFor } from '../run-length';
import type { ExtractedConcept } from './concept-extraction';
import { prepareDocument } from './prepare-input';
import {
  MIN_CONCEPT_SOURCE_WORDS,
  conceptSourceWords,
  conceptsNeeded,
  splitThinConcepts,
  sufficiencyNotice,
} from './sufficiency';

const words = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');

/** One paragraph per word count; returns the document and the chunk ID of each paragraph. */
function docOf(counts: readonly number[]) {
  const doc = prepareDocument(counts.map((n, i) => words(n, `p${i}w`)).join('\n\n'));
  const ids = [...doc.chunks.values()].sort((a, b) => a.position - b.position).map((c) => c.id);
  return { doc, ids };
}

const concept = (conceptId: string, chunkIds: readonly string[]): ExtractedConcept => ({
  conceptId,
  label: conceptId,
  chunkIds,
  quotes: [],
});

describe('conceptSourceWords', () => {
  it('counts a chunk cited twice once and sums distinct chunks', () => {
    const { doc, ids } = docOf([5, 7]);
    expect(conceptSourceWords(concept('c', [ids[0] as string, ids[0] as string]), doc)).toBe(5);
    expect(conceptSourceWords(concept('c', [ids[0] as string, ids[1] as string]), doc)).toBe(12);
  });

  it('ignores unknown chunk IDs', () => {
    const { doc } = docOf([5]);
    expect(conceptSourceWords(concept('c', ['nope']), doc)).toBe(0);
  });
});

describe('splitThinConcepts', () => {
  it('keeps at the 12-word threshold and drops 11, with 13 kept', () => {
    expect(MIN_CONCEPT_SOURCE_WORDS).toBe(12);
    const { doc, ids } = docOf([11, 12, 13]);
    const [a, b, c] = ids as [string, string, string];
    const { kept, thin } = splitThinConcepts([concept('x', [a]), concept('y', [b]), concept('z', [c])], doc);
    expect(thin.map((t) => t.conceptId)).toEqual(['x']);
    expect(kept.map((k) => k.conceptId)).toEqual(['y', 'z']);
  });

  it('preserves input order and concept IDs in both lists', () => {
    const { doc, ids } = docOf([3, 20, 4, 30]);
    const [a, b, c, d] = ids as [string, string, string, string];
    const { kept, thin } = splitThinConcepts(
      [concept('concept-1', [a]), concept('concept-2', [b]), concept('concept-3', [c]), concept('concept-4', [d])],
      doc,
    );
    expect(kept.map((k) => k.conceptId)).toEqual(['concept-2', 'concept-4']);
    expect(thin.map((t) => t.conceptId)).toEqual(['concept-1', 'concept-3']);
  });
});

describe('conceptsNeeded', () => {
  it.each(['short', 'standard', 'long'] as const)('is rooms * locksPerRoom for %s', (length) => {
    const target = cryptTargetFor(length);
    expect(conceptsNeeded(target)).toBe(target.rooms * 2);
  });
});

describe('sufficiencyNotice', () => {
  const target = cryptTargetFor('standard');

  it('is absent without a target', () => {
    expect(sufficiencyNotice(1, undefined, 0)).toBeUndefined();
  });

  it('is absent when the built rooms reach the target', () => {
    expect(sufficiencyNotice(20, target, target.rooms)).toBeUndefined();
  });

  it('is present when fewer rooms were built', () => {
    expect(sufficiencyNotice(3, target, target.rooms - 1)).toEqual({
      goodConcepts: 3,
      conceptsNeeded: conceptsNeeded(target),
      requestedRooms: target.rooms,
      builtRooms: target.rooms - 1,
    });
  });
});
