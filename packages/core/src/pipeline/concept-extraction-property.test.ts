import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveQuote } from '../quote-resolver';
import { paragraphArb } from '../test-support/arbitraries';
import { filterConcepts } from './concept-extraction';
import type { ConceptExtractionResponse } from './concept-extraction-prompt';
import { prepareDocument, type PreparedDocument } from './prepare-input';

type Kind = 'substring' | 'repeated' | 'short' | 'not-found' | 'uncited';

const UNASSIGNED_ID = 'chk_not_assigned_by_code';

/** Notes of 1-8 paragraphs; sometimes a paragraph is repeated so quotes become ambiguous. */
const notesArb: fc.Arbitrary<string> = fc
  .tuple(fc.array(paragraphArb, { minLength: 1, maxLength: 8 }), fc.boolean())
  .map(([ps, repeatFirst]) => (repeatFirst ? [...ps, ps[0]!] : ps).join('\n\n'));

const quoteSpecArb = fc.record({
  kind: fc.constantFrom<Kind>('substring', 'repeated', 'short', 'not-found', 'uncited'),
  chunkPick: fc.nat(1000),
  start: fc.nat(1000),
  len: fc.integer({ min: 4, max: 9 }),
  tag: fc.stringMatching(/^[a-z]{5,8}$/),
});

const conceptSpecArb = fc.record({
  label: fc.stringMatching(/^[a-z]{3,10}$/),
  citePicks: fc.array(fc.nat(1000), { minLength: 1, maxLength: 3 }),
  addUnassigned: fc.boolean(),
  quotes: fc.array(quoteSpecArb, { minLength: 1, maxLength: 5 }),
});

type ConceptSpec = typeof conceptSpecArb extends fc.Arbitrary<infer T> ? T : never;

const specsArb = fc.array(conceptSpecArb, { minLength: 0, maxLength: 6 });

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== '');
}

function build(
  doc: PreparedDocument,
  specs: ConceptSpec[],
): ConceptExtractionResponse {
  const chunks = [...doc.quotableChunksByOrdinal.values()];
  if (chunks.length === 0) return { concepts: [] };
  const pick = (n: number) => chunks[n % chunks.length]!;
  return {
    concepts: specs.map((spec) => {
      const cited = spec.citePicks.map(pick);
      const chunkIds = cited.map((c) => c.id);
      if (spec.addUnassigned) chunkIds.push(UNASSIGNED_ID);
      const quotes = spec.quotes.map((q) => {
        const base = cited[q.chunkPick % cited.length]!;
        const ws = words(base.text);
        const window = (from: number, n: number) =>
          ws.slice(from % ws.length, (from % ws.length) + n).join(' ');
        switch (q.kind) {
          case 'substring':
          case 'repeated': // resolves in every chunk holding the repeated paragraph
            return window(q.start, q.len);
          case 'short':
            return window(q.start, 3);
          case 'not-found':
            return `${q.tag} zzqx ${q.tag} qqzx ${q.tag}`;
          case 'uncited': {
            const others = chunks.filter((c) => !chunkIds.includes(c.id));
            const other = others.length > 0 ? others[q.chunkPick % others.length]! : base;
            const ows = words(other.text);
            return ows.slice(q.start % ows.length, (q.start % ows.length) + q.len).join(' ');
          }
        }
      });
      return { label: spec.label, chunkIds, quotes };
    }),
  };
}

function hitsOf(doc: PreparedDocument, chunkIds: readonly string[], quote: string): number {
  let hits = 0;
  for (const id of new Set(chunkIds)) if (resolveQuote(doc.chunks, id, quote).ok) hits += 1;
  return hits;
}

describe('filterConcepts', () => {
  // Feature: generation-and-evaluation, Property 19: Concept extraction keeps only uniquely-resolving quotes
  it('Property 19: keeps exactly the quotes that resolve uniquely in one cited chunk', () => {
    // **Validates: Requirements 13.4**
    fc.assert(
      fc.property(notesArb, specsArb, (notes, specs) => {
        const doc = prepareDocument(notes);
        const response = build(doc, specs);
        const kept = filterConcepts(doc, response);

        // Expected survivors, computed independently from the response.
        const expected = response.concepts.filter(
          (c) =>
            c.chunkIds.every((id) => doc.ordinalByChunkId.has(id)) &&
            c.quotes.some((q) => hitsOf(doc, c.chunkIds, q) === 1),
        );
        expect(kept.length).toBe(expected.length);

        kept.forEach((k, i) => {
          const source = expected[i]!;
          expect(k.conceptId).toBe(`concept-${i + 1}`);
          expect(k.label).toBe(source.label);
          expect(k.quotes.length).toBeGreaterThan(0);
          expect(k.quotes).toEqual(source.quotes.filter((q) => hitsOf(doc, source.chunkIds, q) === 1));
          for (const id of k.chunkIds) expect(doc.ordinalByChunkId.has(id)).toBe(true);
          for (const quote of k.quotes) {
            const resolving = k.chunkIds.filter((id) => resolveQuote(doc.chunks, id, quote).ok);
            expect(resolving.length).toBe(1);
          }
        });
      }),
      { numRuns: 200 },
    );
  });

  it('exercises the interesting quote kinds (sanity: some concepts survive and some are dropped)', () => {
    let survived = 0;
    let dropped = 0;
    fc.assert(
      fc.property(notesArb, specsArb, (notes, specs) => {
        const doc = prepareDocument(notes);
        const response = build(doc, specs);
        const kept = filterConcepts(doc, response);
        survived += kept.length;
        dropped += response.concepts.length - kept.length;
      }),
      { numRuns: 100 },
    );
    expect(survived).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
  });
});
