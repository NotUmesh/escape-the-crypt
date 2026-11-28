import fc from 'fast-check';
import type { ExtractedConcept } from '../pipeline/concept-extraction';
import type { NumericFact } from '../pipeline/conflict-code';
import { prepareDocument, type PreparedDocument } from '../pipeline/prepare-input';
import type { Chunk } from '../types';

/** Singular units whose plural form folds back to the same word. */
const UNITS = ['day', 'hour', 'year', 'metre', 'kilogram', '%'] as const;

export function makeChunk(id: string, position: number, text: string): Chunk {
  return {
    id,
    documentDigest: 'test-digest',
    position,
    text,
    location: { sourceType: 'paste', paragraphNumber: position + 1 },
    edited: false,
  };
}

/** A sentence (at least 4 words, 20 characters) that states `value unit` once. */
export function factSentence(tag: string, value: number, unit: string, plural: boolean): string {
  const shown = unit === '%' ? '%' : ` ${plural && value !== 1 ? `${unit}s` : unit}`;
  return `Reading ${tag} states a duration of about ${value}${shown} in total.`;
}

/** A fact with a quote that really contains it. Values are integers or halves. */
export function numericFactArb(chunkId = 'chk-fact'): fc.Arbitrary<NumericFact> {
  return fc
    .record({
      whole: fc.integer({ min: 1, max: 999 }),
      half: fc.boolean(),
      unit: fc.constantFrom(...UNITS),
      plural: fc.boolean(),
      tag: fc.stringMatching(/^[a-z]{4,8}$/),
    })
    .map(({ whole, half, unit, plural, tag }) => {
      const value = half ? whole + 0.5 : whole;
      return { value, unit, chunkId, quote: factSentence(tag, value, unit, plural) };
    });
}

/** Label variants that must fold to one key: case, inner spacing, punctuation, edge spaces. */
export function labelVariantArb(base: string): fc.Arbitrary<string> {
  return fc
    .record({
      upper: fc.boolean(),
      gap: fc.constantFrom(' ', '  ', '\t', ' - ', '_'),
      edge: fc.constantFrom('', ' ', '  '),
    })
    .map(({ upper, gap, edge }) => {
      const spaced = base.split(' ').join(gap);
      return `${edge}${upper ? spaced.toUpperCase() : spaced}${edge}`;
    });
}

export interface ConceptWithFacts {
  readonly concept: ExtractedConcept;
  readonly doc: PreparedDocument;
  /** The facts planted in the quotes, one chunk each, sorted like `numericFactsOf`. */
  readonly facts: readonly NumericFact[];
}

/** Builds a document and a concept whose quotes sit one per chunk. */
export function buildConceptWithFacts(
  conceptId: string,
  label: string,
  facts: readonly NumericFact[],
): ConceptWithFacts {
  const placed = facts.map((f, i) => ({ ...f, chunkId: `chk_${conceptId}_${i}` }));
  const doc = prepareDocument(placed.map((f, i) => makeChunk(f.chunkId, i, f.quote)));
  const concept: ExtractedConcept = {
    conceptId,
    label,
    chunkIds: placed.map((f) => f.chunkId),
    quotes: placed.map((f) => f.quote),
  };
  const sorted = [...placed].sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
  return { concept, doc, facts: sorted };
}

/** One concept with one to three planted facts and a label from `labelVariantArb`. */
export function conceptWithFactsArb(
  conceptId = 'concept-1',
  base = 'orbital period',
): fc.Arbitrary<ConceptWithFacts> {
  return fc
    .tuple(labelVariantArb(base), fc.array(numericFactArb(), { minLength: 1, maxLength: 3 }))
    .map(([label, facts]) => buildConceptWithFacts(conceptId, label, facts));
}

/**
 * Two concepts that share a label (written in different variants), state the same unit with
 * different values, and cite different chunks. One document holds both, so the pair is a real
 * input for `findCodeConflicts`. The `adv-18` notes are not used: that fixture is one concept.
 */
export function twoConceptSameLabel(
  label: string,
  otherLabel: string,
  unit = 'day',
  values: readonly [number, number] = [27, 35],
): { concepts: readonly [ExtractedConcept, ExtractedConcept]; doc: PreparedDocument } {
  const quoteA = factSentence('alpha', values[0], unit, true);
  const quoteB = factSentence('bravo', values[1], unit, true);
  const doc = prepareDocument([makeChunk('chk_a', 0, quoteA), makeChunk('chk_b', 1, quoteB)]);
  return {
    doc,
    concepts: [
      { conceptId: 'concept-1', label, chunkIds: ['chk_a'], quotes: [quoteA] },
      { conceptId: 'concept-2', label: otherLabel, chunkIds: ['chk_b'], quotes: [quoteB] },
    ],
  };
}
