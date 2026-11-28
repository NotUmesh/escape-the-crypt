import fc from 'fast-check';
import type { ExtractedConcept } from '../pipeline/concept-extraction';
import { prepareDocument, type PreparedDocument } from '../pipeline/prepare-input';
import { MIN_CONCEPT_SOURCE_WORDS } from '../pipeline/sufficiency';

/** A prepared document, its chunk IDs in position order, and the word count of each chunk. */
export interface SufficiencyScenario {
  readonly doc: PreparedDocument;
  readonly chunkIds: readonly string[];
  readonly wordCounts: readonly number[];
  readonly concepts: readonly ExtractedConcept[];
}

const words = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `${tag}w${i}`).join(' ');

/** Builds a document with one paragraph (one chunk) per word count. */
export function documentOfWordCounts(counts: readonly number[]): {
  readonly doc: PreparedDocument;
  readonly chunkIds: readonly string[];
} {
  const doc = prepareDocument(counts.map((n, i) => words(n, `p${i}`)).join('\n\n'));
  const chunkIds = [...doc.chunks.values()].sort((a, b) => a.position - b.position).map((c) => c.id);
  return { doc, chunkIds };
}

/** Builds a scenario whose concepts cite the given chunk index lists (an index past the end is an unknown ID). */
function scenarioOf(counts: readonly number[], citations: readonly (readonly number[])[]): SufficiencyScenario {
  const { doc, chunkIds } = documentOfWordCounts(counts);
  const concepts = citations.map(
    (indices, i): ExtractedConcept => ({
      conceptId: `concept-${i + 1}`,
      label: `Concept ${i + 1}`,
      chunkIds: indices.map((k) => chunkIds[k] ?? `unknown-${k}`),
      quotes: [],
    }),
  );
  return { doc, chunkIds, wordCounts: counts, concepts };
}

function scenarioArb(wordCount: fc.Arbitrary<number>): fc.Arbitrary<SufficiencyScenario> {
  return fc
    .array(wordCount, { minLength: 1, maxLength: 6 })
    .chain((counts) =>
      fc
        .array(fc.array(fc.nat({ max: counts.length }), { maxLength: 4 }), { maxLength: 8 })
        .map((citations) => scenarioOf(counts, citations)),
    );
}

/** Any mix of thin and thick chunks, with repeated and unknown citations. */
export const conceptsAndDocArb: fc.Arbitrary<SufficiencyScenario> = scenarioArb(
  fc.integer({ min: 1, max: MIN_CONCEPT_SOURCE_WORDS + 8 }),
);

/** Chunks all well under the threshold: most concepts are thin, and only multi-chunk citations can pass. */
export const notEnoughConceptsArb: fc.Arbitrary<SufficiencyScenario> = scenarioArb(
  fc.integer({ min: 1, max: Math.floor(MIN_CONCEPT_SOURCE_WORDS / 2) }),
);
