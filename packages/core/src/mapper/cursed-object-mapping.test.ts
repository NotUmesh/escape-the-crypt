import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import { judge, mapCursedObjectPayload } from '../locks/cursed-object';
import { QuestionSpecSchema, payloadSchemaFor } from '../runtime/manifest-schema';
import { buildContentEntry } from './build-content';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from './manifest-mapper';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readFileSync(path: string, enc: string): string;
}
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as FsLike;
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

const heart = JSON.parse(fs.readFileSync(`${root}/samples/questions/human-heart.json`, 'utf8')) as {
  notes: string;
  questions: Record<string, unknown>[];
};
const maps = buildDocumentChunkMaps(fs.readFileSync(`${root}/samples/${heart.notes}`, 'utf8'));

function hhQ09() {
  const parsed = parseAuthoringQuestion(heart.questions.find((q) => q.id === 'hh-q09'));
  if (!parsed.ok || parsed.value.lockType !== 'cursed-object') throw new Error('hh-q09 not parsed');
  return parsed.value;
}

describe('mapCursedObjectPayload (hh-q09)', () => {
  it('keeps item order, finds the odd item and removes the first non-odd item', () => {
    const q = hhQ09();
    const mapped = mapCursedObjectPayload(q.id, q.items, q.answer);
    expect(mapped?.payload).toEqual({
      optionIds: ['hh-q09-item-0', 'hh-q09-item-1', 'hh-q09-item-2', 'hh-q09-item-3'],
      oddOneOutId: 'hh-q09-item-2',
    });
    expect(mapped?.hintEffect).toEqual({ kind: 'remove-option', optionId: 'hh-q09-item-0' });
  });

  it('removes the second item when the odd item is first', () => {
    const mapped = mapCursedObjectPayload('q', ['a', 'b', 'c', 'd'], 'a');
    expect(mapped?.hintEffect).toEqual({ kind: 'remove-option', optionId: 'q-item-1' });
  });

  it('returns null when the answer is not an item', () => {
    expect(mapCursedObjectPayload('q', ['a', 'b', 'c', 'd'], 'z')).toBeNull();
  });

  it('the real judge accepts the odd item and rejects the others and the removed one', () => {
    const q = hhQ09();
    const mapped = mapCursedObjectPayload(q.id, q.items, q.answer);
    if (mapped === null) throw new Error('unmapped');
    const { payload, hintEffect } = mapped;
    expect(judge(payload, { selectedId: 'hh-q09-item-2' }, null)).toBe('correct');
    expect(judge(payload, { selectedId: 'hh-q09-item-2' }, hintEffect)).toBe('correct');
    expect(judge(payload, { selectedId: 'hh-q09-item-1' }, null)).toBe('wrong');
    expect(judge(payload, { selectedId: 'hh-q09-item-0' }, hintEffect)).toBe('invalid');
  });

  it('content makes item text addressable by ID, in items order', () => {
    const q = hhQ09();
    const entry = buildContentEntry(q, maps, q.id);
    expect(entry.options).toEqual({
      'hh-q09-item-0': 'Left atrium',
      'hh-q09-item-1': 'Right ventricle',
      'hh-q09-item-2': 'Aorta',
      'hh-q09-item-3': 'Right atrium',
    });
    expect(Object.keys(entry.options ?? {})).toEqual([
      'hh-q09-item-0',
      'hh-q09-item-1',
      'hh-q09-item-2',
      'hh-q09-item-3',
    ]);
    expect(entry.excerpts).toHaveLength(2);
    expect(entry.excerpts.every((e) => e.chunkId !== '' && e.optionId === undefined)).toBe(true);
  });

  it('mapAuthoringQuestionToSpec maps hh-q09 end to end to a schema-valid spec the judge solves', () => {
    const q = hhQ09();
    const r = mapAuthoringQuestionToSpec(q, maps, q.id, 'Heart chambers');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { spec } = r.value;
    expect(spec.lockType).toBe('cursed-object');
    expect(QuestionSpecSchema.safeParse(spec).success).toBe(true);
    const payload = spec.payload as { optionIds: string[]; oddOneOutId: string };
    expect(judge(payload, { selectedId: 'hh-q09-item-2' }, spec.hintEffect)).toBe('correct');
  });
});

describe('cursed-object manifest schema and hint narrowing', () => {
  const base = {
    questionId: 'q',
    lockType: 'cursed-object',
    payload: { optionIds: ['a', 'b', 'c', 'd'], oddOneOutId: 'c' },
    evidenceRefs: ['c1'],
    hintEffect: null,
  };
  const parse = (hintEffect: unknown) => QuestionSpecSchema.safeParse({ ...base, hintEffect }).success;

  it('rejects payloads that are not 4 unique ids with the odd one among them', () => {
    const schema = payloadSchemaFor('cursed-object');
    expect(schema?.safeParse(base.payload).success).toBe(true);
    expect(schema?.safeParse({ ...base.payload, oddOneOutId: 'x' }).success).toBe(false);
    expect(schema?.safeParse({ ...base.payload, optionIds: ['a', 'b', 'c'] }).success).toBe(false);
    expect(schema?.safeParse({ ...base.payload, optionIds: ['a', 'a', 'c', 'd'] }).success).toBe(false);
  });

  it('narrows hints to removing a listed non-odd item', () => {
    expect(parse(null)).toBe(true);
    expect(parse({ kind: 'remove-option', optionId: 'a' })).toBe(true);
    expect(parse({ kind: 'remove-option', optionId: 'c' })).toBe(false);
    expect(parse({ kind: 'remove-option', optionId: 'zzz' })).toBe(false);
    expect(parse({ kind: 'tie-thread', pair: ['a', 'b'] })).toBe(false);
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property
  // **Validates: Requirements 22.3, 22.8**
  it('any 4 distinct items with one as the answer map to a schema-valid spec the judge solves', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 4, maxLength: 4 }),
        fc.nat(3),
        fc.string({ minLength: 1 }),
        (items, oddIndex, id) => {
          const mapped = mapCursedObjectPayload(id, items, items[oddIndex] ?? '');
          if (mapped === null) throw new Error('unmapped');
          const spec = {
            questionId: id,
            lockType: 'cursed-object',
            payload: mapped.payload,
            evidenceRefs: ['c1'],
            hintEffect: mapped.hintEffect,
          };
          expect(QuestionSpecSchema.safeParse(spec).success).toBe(true);
          expect(mapped.payload.optionIds[oddIndex]).toBe(mapped.payload.oddOneOutId);
          const odd = mapped.payload.oddOneOutId;
          expect(judge(mapped.payload, { selectedId: odd }, mapped.hintEffect)).toBe('correct');
        },
      ),
    );
  });
});
