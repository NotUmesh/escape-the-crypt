import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  factSentence,
  labelVariantArb,
  makeChunk,
  twoConceptSameLabel,
} from '../test-support/conflict-code-arbitraries';
import type { ExtractedConcept } from './concept-extraction';
import { findCodeConflicts } from './conflict-code';
import { prepareDocument } from './prepare-input';

// Feature: generation-and-evaluation, Property 30: Code conflicts follow their definition and ignore input order

const UNITS = ['day', 'hour', 'year', 'metre', 'kilogram', '%'] as const;
const BASES = ['orbital period', 'lunar cycle', 'tidal range'] as const;

const unitArb = fc.constantFrom(...UNITS);
const valueArb = fc.integer({ min: 1, max: 999 });

const distinctValuesArb = fc
  .tuple(valueArb, valueArb)
  .filter(([a, b]) => a !== b);

const distinctUnitsArb = fc
  .tuple(unitArb, unitArb)
  .filter(([a, b]) => a !== b);

describe('Property 30: code conflicts follow their definition and ignore input order', () => {
  it('reports exactly one conflict for equal label keys, one unit, different values, different chunks', () => {
    // Validates: Requirements 18.1
    fc.assert(
      fc.property(
        fc
          .constantFrom(...BASES)
          .chain((base) => fc.tuple(labelVariantArb(base), labelVariantArb(base))),
        unitArb,
        distinctValuesArb,
        ([la, lb], unit, values) => {
          const { concepts, doc } = twoConceptSameLabel(la, lb, unit, values);
          const found = findCodeConflicts(concepts, doc);
          expect(found).toHaveLength(1);
          expect(found[0]?.conceptIds).toEqual(['concept-1', 'concept-2']);
          expect(found[0]?.unit).toBe(unit);
          expect(found[0]?.passages[0].chunkId).not.toBe(found[0]?.passages[1].chunkId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never reports different units, equal values, different labels or the same chunk', () => {
    // Validates: Requirements 18.1
    fc.assert(
      fc.property(
        fc.constantFrom(...BASES),
        distinctUnitsArb,
        distinctValuesArb,
        valueArb,
        unitArb,
        (base, units, values, same, unit) => {
          // Different units, even with different values.
          const quoteA = factSentence('alpha', values[0], units[0], true);
          const quoteB = factSentence('bravo', values[1], units[1], true);
          const unitDoc = prepareDocument([makeChunk('chk_a', 0, quoteA), makeChunk('chk_b', 1, quoteB)]);
          const unitPair: ExtractedConcept[] = [
            { conceptId: 'concept-1', label: base, chunkIds: ['chk_a'], quotes: [quoteA] },
            { conceptId: 'concept-2', label: base.toUpperCase(), chunkIds: ['chk_b'], quotes: [quoteB] },
          ];
          expect(findCodeConflicts(unitPair, unitDoc)).toEqual([]);

          // Equal values, same unit, different chunks.
          const equal = twoConceptSameLabel(base, base, unit, [same, same]);
          expect(findCodeConflicts(equal.concepts, equal.doc)).toEqual([]);

          // Different values and unit, different labels.
          const otherBase = BASES[(BASES.indexOf(base) + 1) % BASES.length] ?? base;
          const labels = twoConceptSameLabel(base, otherBase, unit, [values[0], values[1]]);
          expect(findCodeConflicts(labels.concepts, labels.doc)).toEqual([]);

          // Same chunk: two sentences of one chunk, one quote each.
          const qa = factSentence('alpha', values[0], unit, true);
          const qb = factSentence('bravo', values[1], unit, true);
          const doc = prepareDocument([makeChunk('chk_x', 0, `${qa} ${qb}`)]);
          const sameChunk: ExtractedConcept[] = [
            { conceptId: 'concept-1', label: base, chunkIds: ['chk_x'], quotes: [qa] },
            { conceptId: 'concept-2', label: base, chunkIds: ['chk_x'], quotes: [qb] },
          ];
          expect(findCodeConflicts(sameChunk, doc)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('matches the definition and gives the same sorted result for every input order', () => {
    // Validates: Requirements 18.1
    const specArb = fc.record({
      base: fc.constantFrom(...BASES),
      unit: fc.constantFrom('day', 'hour', 'metre'),
      value: fc.integer({ min: 1, max: 4 }),
      variant: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc
          .array(specArb, { minLength: 2, maxLength: 6 })
          .chain((specs) =>
            fc
              .shuffledSubarray(
                specs.map((_s, i) => i),
                { minLength: specs.length, maxLength: specs.length },
              )
              .map((order) => ({ specs, order })),
          ),
        ({ specs, order }) => {
          const quotes = specs.map((s, i) => factSentence(`tag${'abcdefgh'[i]}`, s.value, s.unit, true));
          const doc = prepareDocument(quotes.map((q, i) => makeChunk(`chk_${i}`, i, q)));
          const concepts: ExtractedConcept[] = specs.map((s, i) => ({
            conceptId: `c${i}`,
            label: s.variant ? ` ${s.base.toUpperCase()} ` : s.base,
            chunkIds: [`chk_${i}`],
            quotes: [quotes[i] ?? ''],
          }));

          const expected: string[] = [];
          for (let i = 0; i < specs.length; i += 1) {
            for (let j = i + 1; j < specs.length; j += 1) {
              const a = specs[i];
              const b = specs[j];
              if (a && b && a.base === b.base && a.unit === b.unit && a.value !== b.value) {
                expected.push(`c${i}|c${j}`);
              }
            }
          }

          const render = (list: readonly ExtractedConcept[]): string[] =>
            findCodeConflicts(list, doc).map((c) => c.conceptIds.join('|'));

          const forward = render(concepts);
          const permuted = render(order.map((i) => concepts[i] as ExtractedConcept));
          expect(forward).toEqual(expected);
          expect(permuted).toEqual(forward);
          expect(forward).toEqual([...forward].sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('takes only concepts and a document, so no provider can be called', () => {
    // Validates: Requirements 18.1
    expect(findCodeConflicts.length).toBe(2);
  });
});
