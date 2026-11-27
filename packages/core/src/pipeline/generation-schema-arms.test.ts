import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import {
  buildGenerationResponseSchema,
  toAuthoringQuestion,
  type GeneratedQuestion,
  type QuestionIdentity,
} from './generation-schema';
import { toModelJsonSchema } from '../provider/model-json-schema';
import { prepareDocument } from './prepare-input';

const NOTES = [
  'Mitochondria produce most of the energy that a cell uses to stay alive and to grow over time.',
  'CELL ORGANELLES OVERVIEW',
  'Ribosomes build proteins from amino acids, following instructions copied from the genetic material.',
  'The nucleus stores the genetic material and controls which genes are active in the cell.',
].join('\n\n');

/** The original two-type schema, built from an explicit list now that the default has six arms. */
const TWO_TYPE_SCHEMA = buildGenerationResponseSchema(['rune-cipher', 'seance-board']);
const doc = prepareDocument(NOTES);
const quotableIds: readonly string[] = [...doc.quotableChunksByOrdinal.values()].map((c) => c.id);
const ident: QuestionIdentity = { id: 'q1', conceptId: 'c1', role: 'primary' };
const id0 = quotableIds[0]!;
const id1 = quotableIds[1]!;
const id2 = quotableIds[2]!;

const schemaJson = (s: Parameters<typeof toModelJsonSchema>[0]): string => {
  const r = toModelJsonSchema(s);
  if (!r.ok) throw new Error('schema not representable');
  return JSON.stringify(r.value);
};

describe('toAuthoringQuestion: bound-threads and cursed-object arms', () => {
  it('translates a bound-threads arm and rejects an unassigned chunk ID', () => {
    const arm: GeneratedQuestion = {
      lockType: 'bound-threads',
      prompt: 'According to your notes, connect each item to its job.',
      pairs: [
        { left: 'Mitochondria', right: 'Energy', evidence: { chunkId: id0, quote: 'Mitochondria produce' } },
        { left: 'Ribosomes', right: 'Proteins', evidence: { chunkId: id1, quote: 'Ribosomes build proteins' } },
        { left: 'Nucleus', right: 'Genetic material', evidence: { chunkId: id2, quote: 'stores the genetic material' } },
      ],
      explanation: 'See paragraphs 1 to 3.',
    };
    const result = toAuthoringQuestion(arm, ident, doc);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.lockType !== 'bound-threads') return;
    expect(result.value.pairs.map((p) => p.evidence.paragraph)).toEqual([1, 2, 3]);
    expect(result.value.pairs.map((p) => p.left)).toEqual(['Mitochondria', 'Ribosomes', 'Nucleus']);
    expect(result.value).toMatchObject(ident);
    const bad = toAuthoringQuestion(
      { ...arm, pairs: arm.pairs.map((p, i) => (i === 1 ? { ...p, evidence: { chunkId: 'nope', quote: 'q' } } : p)) },
      ident,
      doc,
    );
    expect(!bad.ok && bad.error.kind).toBe('pipeline-unknown-chunk');
    const withThreads = buildGenerationResponseSchema(['bound-threads']);
    expect(withThreads.safeParse({ justification: 'j', primary: arm, alternate: null }).success).toBe(true);
    expect(withThreads.safeParse({ justification: 'j', primary: { ...arm, pairs: arm.pairs.slice(0, 2) }, alternate: null }).success).toBe(false);
    expect(TWO_TYPE_SCHEMA.safeParse({ justification: 'j', primary: arm, alternate: null }).success).toBe(false);
  });

  it('translates a cursed-object arm, has no hint field, and rejects an unassigned chunk ID', () => {
    const arm: GeneratedQuestion = {
      lockType: 'cursed-object',
      prompt: 'According to your notes, three of these are organelles. Which one is not?',
      items: ['Mitochondria', 'Ribosomes', 'Nucleus', 'Femur'],
      answer: 'Femur',
      categoryRule: 'Organelles are the structures inside a cell.',
      evidence: [{ chunkId: id0, quote: 'Mitochondria produce' }, { chunkId: id2, quote: 'stores the genetic material' }],
      explanation: 'See paragraphs 1 and 3.',
    };
    const result = toAuthoringQuestion(arm, ident, doc);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.lockType !== 'cursed-object') return;
    expect(result.value.evidence.map((e) => e.paragraph)).toEqual([1, 3]);
    expect(result.value.items).toEqual(['Mitochondria', 'Ribosomes', 'Nucleus', 'Femur']);
    expect(result.value).toMatchObject(ident);
    const bad = toAuthoringQuestion({ ...arm, evidence: [{ chunkId: 'nope', quote: 'q' }] }, ident, doc);
    expect(!bad.ok && bad.error.kind).toBe('pipeline-unknown-chunk');
    const withCursed = buildGenerationResponseSchema(['cursed-object']);
    expect(withCursed.safeParse({ justification: 'j', primary: arm, alternate: null }).success).toBe(true);
    expect(withCursed.safeParse({ justification: 'j', primary: { ...arm, items: arm.items.slice(0, 3) }, alternate: null }).success).toBe(false);
    expect(withCursed.safeParse({ justification: 'j', primary: { ...arm, hint: null }, alternate: null }).success).toBe(false);
    expect(TWO_TYPE_SCHEMA.safeParse({ justification: 'j', primary: arm, alternate: null }).success).toBe(false);
    expect(schemaJson(TWO_TYPE_SCHEMA)).not.toContain('cursed-object');
  });

});

describe('toAuthoringQuestion: combination-dial arm', () => {
  const answers = [
    { kind: 'exact' as const, value: 4 },
    { kind: 'range' as const, min: 60, max: 100 },
    { kind: 'template' as const, template: 'difference' as const, inputs: [100, 80], value: 20 },
    { kind: 'template' as const, template: 'percent-change' as const, inputs: [100, 80], value: -20 },
  ];
  const arm = (answer: (typeof answers)[number]): GeneratedQuestion => ({
    lockType: 'combination-dial',
    prompt: 'According to your notes, how many cells are there?',
    answer,
    units: 'cells',
    evidence: [{ chunkId: id0, quote: 'Mitochondria produce' }],
    explanation: 'See paragraph 1.',
  });

  // Property 14.1: whatever the arm holds, the translated question re-parses as an AuthoringQuestion.
  it('re-parses every answer kind with ordinals and identity attached', () => {
    fc.assert(
      fc.property(fc.constantFrom(...answers), fc.double({ noNaN: true, noDefaultInfinity: true }), (answer, n) => {
        const generated = arm(answer.kind === 'exact' ? { ...answer, value: n } : answer);
        const result = toAuthoringQuestion(generated, ident, doc);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(parseAuthoringQuestion(result.value).ok).toBe(true);
        expect(result.value).toMatchObject(ident);
        if (result.value.lockType === 'combination-dial') expect(result.value.evidence[0]?.paragraph).toBe(1);
      }),
      { numRuns: 50 },
    );
  });

  it('rejects an unassigned chunk ID, is offered only when allowed, and has no expression field', () => {
    const bad = toAuthoringQuestion(
      {
        lockType: 'combination-dial',
        prompt: 'According to your notes, how many cells are there?',
        answer: answers[0]!,
        units: 'cells',
        evidence: [{ chunkId: 'nope', quote: 'q' }],
        explanation: 'x',
      },
      ident,
      doc,
    );
    expect(!bad.ok && bad.error.kind).toBe('pipeline-unknown-chunk');
    const withDial = buildGenerationResponseSchema(['combination-dial']);
    const parses = (primary: unknown) => withDial.safeParse({ justification: 'j', primary, alternate: null }).success;
    for (const a of answers) expect(parses(arm(a))).toBe(true);
    expect(parses({ ...arm(answers[2]!), answer: { ...answers[2], expression: '100-80' } })).toBe(false);
    expect(parses({ ...arm(answers[0]!), hint: null })).toBe(false);
    expect(parses({ ...arm(answers[2]!), answer: { ...answers[2], template: 'elasticity' } })).toBe(false);
    expect(TWO_TYPE_SCHEMA.safeParse({ justification: 'j', primary: arm(answers[0]!), alternate: null }).success).toBe(false);
    expect(schemaJson(TWO_TYPE_SCHEMA)).not.toContain('combination-dial');
    expect(schemaJson(withDial)).not.toMatch(/expression|code/);
  });
});
