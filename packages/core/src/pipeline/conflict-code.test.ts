import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildConceptWithFacts,
  conceptWithFactsArb,
  factSentence,
  labelVariantArb,
  makeChunk,
  numericFactArb,
  twoConceptSameLabel,
} from '../test-support/conflict-code-arbitraries';
import type { ExtractedConcept } from './concept-extraction';
import { findCodeConflicts, labelKey, numericFactsOf } from './conflict-code';
import { prepareDocument } from './prepare-input';

const SEED = { seed: 4403, numRuns: 25 } as const;

describe('labelKey', () => {
  it('folds case, spacing, punctuation and curly quotes', () => {
    expect(labelKey('  Orbital   Period ')).toBe('orbitalperiod');
    expect(labelKey('orbital-period')).toBe('orbitalperiod');
    expect(labelKey('The Moon\u2019s orbit')).toBe('themoonsorbit');
    expect(labelKey('---')).toBe('');
  });

  it('maps every generated variant of one label to the same key', () => {
    for (const variant of fc.sample(labelVariantArb('orbital period'), SEED)) {
      expect(labelKey(variant)).toBe('orbitalperiod');
    }
  });
});

describe('numericFactsOf', () => {
  it('reads numbers followed by a unit word or %, with unit lower-cased and singular', () => {
    const quote = 'The Moon takes about 27 Days to orbit Earth and 5% of it is lit.';
    const { concept, doc } = buildConceptWithFacts('concept-1', 'moon', [
      { value: 0, unit: 'x', chunkId: 'x', quote },
    ]);
    const facts = numericFactsOf(concept, doc);
    expect(facts.map((f) => [f.value, f.unit])).toEqual([
      [5, '%'],
      [27, 'day'],
    ]);
    expect(facts.every((f) => f.chunkId === 'chk_concept-1_0')).toBe(true);
  });

  it('ignores numbers with no unit, function words, and numbers outside the concept quotes', () => {
    const quote = 'Section 4, then 3 of the items, and 2 and 3 are shown.';
    const other = 'The whole chunk also says 99 days elsewhere.';
    const doc = prepareDocument([makeChunk('c0', 0, `${quote} ${other}`)]);
    const concept: ExtractedConcept = { conceptId: 'concept-1', label: 'x', chunkIds: ['c0'], quotes: [quote] };
    expect(numericFactsOf(concept, doc)).toEqual([]);
  });

  it('reads thousands separators and decimals, and skips a quote that resolves nowhere', () => {
    const quote = 'The cycle takes about 29.5 days and covers 1,200 metres in total.';
    const doc = prepareDocument([makeChunk('c0', 0, quote)]);
    const concept: ExtractedConcept = {
      conceptId: 'concept-1',
      label: 'x',
      chunkIds: ['c0'],
      quotes: [quote, 'This quote is not in the notes at all, 40 days.'],
    };
    expect(numericFactsOf(concept, doc).map((f) => [f.value, f.unit])).toEqual([
      [29.5, 'day'],
      [1200, 'metre'],
    ]);
  });

  it('returns the planted facts for generated concepts', () => {
    for (const { concept, doc, facts } of fc.sample(conceptWithFactsArb(), SEED)) {
      const got = numericFactsOf(concept, doc);
      expect(got.map((f) => [f.chunkId, f.unit, f.value])).toEqual(
        facts.map((f) => [f.chunkId, f.unit, f.value]),
      );
    }
  });

  it('plants numeric facts that the reader finds', () => {
    for (const fact of fc.sample(numericFactArb(), SEED)) {
      const built = buildConceptWithFacts('concept-1', 'x', [fact]);
      expect(numericFactsOf(built.concept, built.doc).map((f) => [f.value, f.unit])).toEqual([
        [fact.value, fact.unit],
      ]);
    }
  });
});

describe('findCodeConflicts', () => {
  it('flags two concepts with one label (case and spacing variants), one unit, different values', () => {
    const { concepts, doc } = twoConceptSameLabel('Orbital Period', '  orbital   PERIOD ');
    const found = findCodeConflicts(concepts, doc);
    expect(found).toHaveLength(1);
    expect(found[0]!.conceptIds).toEqual(['concept-1', 'concept-2']);
    expect(found[0]!.unit).toBe('day');
    expect(found[0]!.passages.map((p) => p.chunkId)).toEqual(['chk_a', 'chk_b']);
    expect(found[0]!.passages[0].quote).toContain('27 days');
    expect(found[0]!.passages[1].quote).toContain('35 days');
  });

  it('does not depend on input order', () => {
    const { concepts, doc } = twoConceptSameLabel('Orbital Period', 'orbital period');
    const forward = findCodeConflicts(concepts, doc);
    const backward = findCodeConflicts([concepts[1], concepts[0]], doc);
    expect(backward).toEqual(forward);
  });

  it('does not flag equal values, different units, different labels or a shared chunk', () => {
    const same = twoConceptSameLabel('orbit', 'orbit', 'day', [27, 27]);
    expect(findCodeConflicts(same.concepts, same.doc)).toEqual([]);

    const a = twoConceptSameLabel('orbit', 'orbit', 'day', [27, 35]);
    const hours = prepareDocument([
      makeChunk('chk_a', 0, factSentence('alpha', 27, 'day', true)),
      makeChunk('chk_b', 1, factSentence('bravo', 35, 'hour', true)),
    ]);
    expect(findCodeConflicts(a.concepts, hours)).toEqual([]);

    const labels = twoConceptSameLabel('orbit', 'rotation');
    expect(findCodeConflicts(labels.concepts, labels.doc)).toEqual([]);

    const quote = `${factSentence('alpha', 27, 'day', true)} ${factSentence('bravo', 35, 'day', true)}`;
    const doc = prepareDocument([makeChunk('chk_a', 0, quote)]);
    const both: ExtractedConcept[] = [
      { conceptId: 'concept-1', label: 'orbit', chunkIds: ['chk_a'], quotes: [factSentence('alpha', 27, 'day', true)] },
      { conceptId: 'concept-2', label: 'orbit', chunkIds: ['chk_a'], quotes: [factSentence('bravo', 35, 'day', true)] },
    ];
    expect(findCodeConflicts(both, doc)).toEqual([]);
  });

  it('is not triggered by one concept holding two numbers', () => {
    const built = buildConceptWithFacts('concept-1', 'orbit', [
      { value: 27, unit: 'day', chunkId: 'x', quote: factSentence('alpha', 27, 'day', true) },
      { value: 35, unit: 'day', chunkId: 'x', quote: factSentence('bravo', 35, 'day', true) },
    ]);
    expect(findCodeConflicts([built.concept], built.doc)).toEqual([]);
  });

  it('sorts several conflicts by conceptIds', () => {
    const a = buildConceptWithFacts('concept-3', 'Orbit', [
      { value: 1, unit: 'day', chunkId: 'x', quote: factSentence('alpha', 27, 'day', true) },
    ]);
    const b = buildConceptWithFacts('concept-1', 'orbit', [
      { value: 1, unit: 'day', chunkId: 'x', quote: factSentence('bravo', 35, 'day', true) },
    ]);
    const c = buildConceptWithFacts('concept-2', 'ORBIT', [
      { value: 1, unit: 'day', chunkId: 'x', quote: factSentence('charlie', 40, 'day', true) },
    ]);
    // One document holding all three chunks.
    const doc = prepareDocument([
      ...[a, b, c].flatMap((x) => [...x.doc.chunks.values()]).map((ch, i) => ({ ...ch, position: i })),
    ]);
    const found = findCodeConflicts([a.concept, b.concept, c.concept], doc);
    expect(found.map((f) => f.conceptIds)).toEqual([
      ['concept-1', 'concept-2'],
      ['concept-1', 'concept-3'],
      ['concept-2', 'concept-3'],
    ]);
  });

  /**
   * adv-18 (eval/adversarial/fixtures.json, notes adv-01-moon.txt) is ONE concept whose notes hold
   * 27 days (paragraph 4) and 35 days (paragraph 7). Requirement 18.1 needs two concepts that share
   * a label, so this layer does not catch it. The model layer (Requirement 18.2) does. See design
   * 1a "Honest limit" and Reconciliation (a). The same scan over a single concept stays empty.
   */
  it('does NOT catch adv-18: one concept with two numbers is not a code conflict', async () => {
    const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
    const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
    const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
    const here = url
      .fileURLToPath((import.meta as unknown as { url: string }).url)
      .replace(/\\/g, '/')
      .replace(/\/[^/]*$/, '');
    const notes = fs.readFileSync(`${here}/../../../../eval/adversarial/notes/adv-01-moon.txt`, 'utf8');
    const doc = prepareDocument(notes);
    const concept: ExtractedConcept = {
      conceptId: 'adv-18-c',
      label: 'Moon orbit',
      chunkIds: [...doc.ordinalByChunkId.keys()],
      quotes: ['The Moon takes about 27 days to orbit Earth.', 'One orbit of the Moon around Earth takes about 35 days.'],
    };
    const facts = numericFactsOf(concept, doc);
    expect(facts.map((f) => [f.value, f.unit])).toEqual(
      expect.arrayContaining([
        [27, 'day'],
        [35, 'day'],
      ]),
    );
    expect(findCodeConflicts([concept], doc)).toEqual([]);
  });
});
