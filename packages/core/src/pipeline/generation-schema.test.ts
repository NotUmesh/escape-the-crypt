import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import {
  GenerationResponseSchema,
  toAuthoringQuestion,
  type GeneratedQuestion,
  type QuestionIdentity,
} from './generation-schema';
import { prepareDocument } from './prepare-input';

const NOTES = [
  'Mitochondria produce most of the energy that a cell uses to stay alive and to grow over time.',
  'CELL ORGANELLES OVERVIEW',
  'Ribosomes build proteins from amino acids, following instructions copied from the genetic material.',
  'The nucleus stores the genetic material and controls which genes are active in the cell.',
].join('\n\n');

const doc = prepareDocument(NOTES);
const quotableIds: readonly string[] = [...doc.quotableChunksByOrdinal.values()].map((c) => c.id);

const text = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);
const chunkId = fc.constantFrom(...quotableIds);
const evidence = fc.record({ chunkId, quote: fc.string({ maxLength: 40 }) });

const hint = fc.oneof(
  fc.constant(null),
  fc.record({
    kind: fc.constant('first-letter-and-length' as const),
    firstLetter: fc.string({ minLength: 1, maxLength: 1 }),
    length: fc.integer({ min: 1, max: 30 }),
  }),
);

const rune = fc.record({
  lockType: fc.constant('rune-cipher' as const),
  prompt: text,
  answer: text,
  aliases: fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
  caseSensitive: fc.boolean(),
  evidence: fc.array(evidence, { minLength: 1, maxLength: 3 }),
  explanation: fc.string({ maxLength: 60 }),
  hint,
});

const option = fc.record({
  id: text,
  text,
  label: fc.constantFrom('supported' as const, 'contradicted' as const),
  evidence,
});

const seance = fc.record({
  lockType: fc.constant('seance-board' as const),
  prompt: text,
  options: fc.array(option, { minLength: 3, maxLength: 4 }),
  answer: text,
  explanation: fc.string({ maxLength: 60 }),
});

const identity = fc.record({
  id: text,
  conceptId: text,
  role: fc.constantFrom('primary' as const, 'alternate' as const),
});

describe('toAuthoringQuestion', () => {
  it('has quotable chunks to draw from', () => {
    expect(quotableIds.length).toBe(3);
  });

  it('always yields a question that parses as an AuthoringQuestion (Req 14.1)', () => {
    fc.assert(
      fc.property(fc.oneof(rune, seance), identity, (generated, ident) => {
        const result = toAuthoringQuestion(generated, ident, doc);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(parseAuthoringQuestion(result.value).ok).toBe(true);
        expect(result.value.id).toBe(ident.id);
        expect(result.value.conceptId).toBe(ident.conceptId);
        expect(result.value.role).toBe(ident.role);
      }),
      { numRuns: 200 },
    );
  });

  const ident: QuestionIdentity = { id: 'q1', conceptId: 'c1', role: 'primary' };
  const id0 = quotableIds[0]!;
  const id1 = quotableIds[1]!;
  const id2 = quotableIds[2]!;

  const runeArm: GeneratedQuestion = {
    lockType: 'rune-cipher',
    prompt: 'According to your notes, mitochondria produce most of the cell’s ____.',
    answer: 'energy',
    aliases: [],
    caseSensitive: false,
    evidence: [{ chunkId: id0, quote: 'Mitochondria produce most of the energy' }],
    explanation: 'Stated in the first paragraph.',
    hint: null,
  };

  const seanceOptions = [
    { id: 'a', text: 'Energy', label: 'supported' as const, evidence: { chunkId: id0, quote: 'energy' } },
    { id: 'b', text: 'Proteins', label: 'contradicted' as const, evidence: { chunkId: id1, quote: 'build proteins' } },
    { id: 'c', text: 'Genes', label: 'contradicted' as const, evidence: { chunkId: id2, quote: 'genetic material' } },
    { id: 'd', text: 'Water', label: 'contradicted' as const, evidence: { chunkId: id2, quote: 'active in the cell' } },
  ];

  it('translates a rune arm: ordinals, identity attached, null hint dropped', () => {
    const result = toAuthoringQuestion(runeArm, ident, doc);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.lockType !== 'rune-cipher') return;
    expect(result.value.evidence).toEqual([
      { paragraph: 1, quote: 'Mitochondria produce most of the energy' },
    ]);
    expect(result.value).not.toHaveProperty('hint');
    expect(result.value).toMatchObject(ident);
  });

  it('drops a rune hint, right or wrong: the mapper computes it from the answer', () => {
    // Mitochondria has 12 letters: this hint is wrong on both fields, and must not reach the mapper.
    const hint = { kind: 'first-letter-and-length' as const, firstLetter: 'e', length: 6 };
    const result = toAuthoringQuestion({ ...runeArm, hint }, ident, doc);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).not.toHaveProperty('hint');
  });

  it.each([3, 4])('translates a séance arm with %i options', (n) => {
    const arm: GeneratedQuestion = {
      lockType: 'seance-board',
      prompt: 'According to your notes, what do mitochondria produce?',
      options: seanceOptions.slice(0, n),
      answer: 'a',
      explanation: 'See the first paragraph.',
    };
    const result = toAuthoringQuestion(arm, ident, doc);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.lockType !== 'seance-board') return;
    expect(result.value.options).toHaveLength(n);
    expect(result.value.options.map((o) => o.evidence.paragraph)).toEqual([1, 2, 3, 3].slice(0, n));
  });

  it('returns pipeline-unknown-chunk for an unassigned chunk ID without throwing', () => {
    const bad: GeneratedQuestion = {
      ...runeArm,
      evidence: [{ chunkId: 'not-a-chunk', quote: 'x' }],
    };
    const result = toAuthoringQuestion(bad, ident, doc);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'pipeline-unknown-chunk', chunkId: 'not-a-chunk' },
    });
    const badSeance: GeneratedQuestion = {
      lockType: 'seance-board',
      prompt: 'p',
      options: seanceOptions.slice(0, 3).map((o, i) =>
        i === 1 ? { ...o, evidence: { chunkId: 'nope', quote: 'q' } } : o,
      ),
      answer: 'a',
      explanation: '',
    };
    const r2 = toAuthoringQuestion(badSeance, ident, doc);
    expect(!r2.ok && r2.error.kind).toBe('pipeline-unknown-chunk');
  });

  it('GenerationResponseSchema accepts the arms used above', () => {
    const parsed = GenerationResponseSchema.safeParse({
      justification: 'j',
      primary: runeArm,
      alternate: null,
    });
    expect(parsed.success).toBe(true);
  });
});
