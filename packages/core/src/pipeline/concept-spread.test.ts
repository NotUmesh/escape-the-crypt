import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cryptTargetFor } from '../run-length';
import type { ExtractedConcept } from './concept-extraction';
import { conceptsForTarget, selectSpreadConcepts } from './concept-spread';
import { prepareDocument, type PreparedDocument } from './prepare-input';

/** A document of `n` paragraphs, each long enough to be its own chunk. */
function documentOf(n: number): PreparedDocument {
  const paragraphs = Array.from(
    { length: n },
    (_, i) => `Paragraph ${i + 1} says that thing ${i + 1} is explained here in plain words, with a full sentence to read.`,
  );
  return prepareDocument(paragraphs.join('\n\n'));
}

/** One concept per listed chunk index (in the order given), citing that chunk. */
function conceptsAt(doc: PreparedDocument, chunkIndexes: readonly number[]): ExtractedConcept[] {
  const chunks = [...doc.chunks.values()].sort((a, b) => a.position - b.position);
  return chunkIndexes.map((at, i) => ({
    conceptId: `concept-${i + 1}`,
    label: `Concept ${i + 1}`,
    chunkIds: [(chunks[at] as { id: string }).id],
    quotes: ['a quote of four words'],
  }));
}

const positions = (doc: PreparedDocument, picked: readonly ExtractedConcept[]): number[] =>
  picked.map((c) => doc.chunks.get(c.chunkIds[0] as string)?.position ?? -1);

describe('selectSpreadConcepts', () => {
  const doc = documentOf(10);

  it('keeps every concept when there are no more than the cap', () => {
    const concepts = conceptsAt(doc, [0, 3, 9]);
    expect(selectSpreadConcepts(concepts, 3, doc)).toEqual(concepts);
    expect(selectSpreadConcepts(concepts, 6, doc)).toEqual(concepts);
  });

  it('reaches the end of the notes instead of taking the first concepts', () => {
    // Eight concepts crowd chunks 0 to 2, two sit at chunks 8 and 9.
    const concepts = conceptsAt(doc, [0, 0, 0, 1, 1, 2, 2, 2, 8, 9]);
    const picked = selectSpreadConcepts(concepts, 3, doc);
    expect(picked).toHaveLength(3);
    expect(Math.max(...positions(doc, picked))).toBeGreaterThanOrEqual(8);
    // In document order, the first three would all have sat at chunk 0.
    expect(positions(doc, concepts.slice(0, 3))).toEqual([0, 0, 0]);
  });

  it('picks one concept per band when the notes are even', () => {
    const concepts = conceptsAt(doc, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const bands = positions(doc, selectSpreadConcepts(concepts, 5, doc));
    // Five bands of two chunks: each band holds exactly one pick.
    expect(bands.map((p) => Math.floor(p / 2))).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns the kept concepts in extraction order with their own IDs', () => {
    const concepts = conceptsAt(doc, [9, 0, 5, 2, 7, 1]);
    const picked = selectSpreadConcepts(concepts, 3, doc);
    const order = picked.map((c) => concepts.indexOf(c));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const c of picked) expect(c.conceptId).toMatch(/^concept-\d+$/);
  });

  it('is deterministic, and a spread of a spread changes nothing', () => {
    const concepts = conceptsAt(doc, [0, 0, 1, 3, 4, 4, 6, 7, 9, 9]);
    const once = selectSpreadConcepts(concepts, 4, doc);
    expect(selectSpreadConcepts(concepts, 4, doc)).toEqual(once);
    expect(selectSpreadConcepts(once, 4, doc)).toEqual(once);
  });

  it('keeps nothing for a cap of zero', () => {
    expect(selectSpreadConcepts(conceptsAt(doc, [0, 1]), 0, doc)).toEqual([]);
  });
});

describe('conceptsForTarget', () => {
  const doc = documentOf(10);
  const concepts = conceptsAt(doc, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it('keeps all concepts without a target', () => {
    expect(conceptsForTarget(concepts, undefined, doc)).toEqual(concepts);
  });

  it('caps at three concepts per room', () => {
    expect(conceptsForTarget(concepts, cryptTargetFor('short'), doc)).toHaveLength(6);
    expect(conceptsForTarget(concepts, cryptTargetFor('standard'), doc)).toHaveLength(9);
    expect(conceptsForTarget(concepts, cryptTargetFor('long'), doc)).toHaveLength(10);
  });
});

// Feature: run length and difficulty, concept selection
describe('Property: the spread keeps a spread-out, ordered subset of the cap size', () => {
  it('holds for any concept positions and any cap', () => {
    const doc = documentOf(12);
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 11 }), { minLength: 0, maxLength: 30 }), fc.integer({ min: 0, max: 14 }), (at, max) => {
        const concepts = conceptsAt(doc, at);
        const picked = selectSpreadConcepts(concepts, max, doc);
        expect(picked).toHaveLength(Math.min(concepts.length, Math.max(0, max)));
        const order = picked.map((c) => concepts.indexOf(c));
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(new Set(picked).size).toBe(picked.length);
        // Reaches the last band when a concept sits there and the cap is not tiny.
        if (max >= 2 && concepts.length > max && at.some((p) => p === 11)) {
          expect(Math.max(...positions(doc, picked))).toBeGreaterThanOrEqual(Math.floor((11 * (max - 1)) / max) - 1);
        }
      }),
      { numRuns: 200 },
    );
  });
});
