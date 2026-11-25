import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from './manifest-mapper';

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(path: string, enc: string): string };
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

function raw(id: string): Record<string, unknown> {
  const found = heart.questions.find((q) => q.id === id);
  if (!found) throw new Error(`no sample question ${id}`);
  return found;
}

function without(source: Record<string, unknown>, key: string): AuthoringQuestion {
  const copy = { ...source };
  delete copy[key];
  return copy as unknown as AuthoringQuestion;
}

function map(question: unknown, title: string | undefined = 'Title') {
  return mapAuthoringQuestionToSpec(question as AuthoringQuestion, maps, 'hh-qx', title);
}

describe('mapper is total on malformed questions', () => {
  it.each(['hh-q01', 'hh-q03'])('%s without an explanation returns authoring-schema-invalid', (id) => {
    const result = map(without(raw(id), 'explanation'));
    expect(result).toEqual({
      ok: false,
      error: { kind: 'authoring-schema-invalid', questionId: 'hh-qx', conceptId: raw(id).conceptId },
    });
  });

  it.each([
    ['hh-q01', 'prompt'],
    ['hh-q01', 'answer'],
    ['hh-q01', 'evidence'],
    ['hh-q03', 'prompt'],
    ['hh-q03', 'options'],
    ['hh-q03', 'answer'],
  ])('%s without %s returns a typed error', (id, field) => {
    const result = map(without(raw(id), field));
    expect(result.ok).toBe(false);
    expect(!result.ok && typeof result.error.kind).toBe('string');
  });

  it('reports an empty conceptId when the question has none', () => {
    const result = map(without(raw('hh-q01'), 'conceptId'));
    expect(result).toEqual({
      ok: false,
      error: { kind: 'authoring-schema-invalid', questionId: 'hh-qx', conceptId: '' },
    });
  });

  it('returns a typed error for non-object input', () => {
    for (const value of [null, undefined, 3, 'x', []]) expect(map(value).ok).toBe(false);
  });

  it('still maps a complete question', () => {
    const parsed = parseAuthoringQuestion(raw('hh-q01'));
    expect(parsed.ok && map(parsed.value).ok).toBe(true);
  });

  it('never throws and always returns a Result for arbitrary values', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const result = map(value);
        expect(typeof result.ok).toBe('boolean');
      }),
    );
  });

  it('never throws on sample questions with fields dropped or replaced', () => {
    const keys = ['prompt', 'explanation', 'answer', 'options', 'evidence', 'aliases', 'lockType', 'conceptId', 'id'];
    fc.assert(
      fc.property(
        fc.constantFrom('hh-q01', 'hh-q03'),
        fc.subarray(keys),
        fc.dictionary(fc.constantFrom(...keys), fc.anything()),
        (id, dropped, replaced) => {
          const broken: Record<string, unknown> = { ...raw(id), ...replaced };
          for (const key of dropped) delete broken[key];
          const result = map(broken);
          expect(typeof result.ok).toBe('boolean');
          if (!result.ok) expect(typeof result.error.kind).toBe('string');
        },
      ),
    );
  });
});
