import { describe, expect, it } from 'vitest';
import {
  GenerationResponseSchema,
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
    expect(GenerationResponseSchema.safeParse({ justification: 'j', primary: arm, alternate: null }).success).toBe(false);
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
    expect(GenerationResponseSchema.safeParse({ justification: 'j', primary: arm, alternate: null }).success).toBe(false);
    expect(schemaJson(GenerationResponseSchema)).not.toContain('cursed-object');
  });

});
