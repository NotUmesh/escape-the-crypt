import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import { judge, mapBoneOrderingPayload } from '../locks/bone-ordering';
import { QuestionSpecSchema, payloadSchemaFor } from '../runtime/manifest-schema';
import { buildContentEntry } from './build-content';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from './manifest-mapper';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
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

function hhQ05() {
  const parsed = parseAuthoringQuestion(heart.questions.find((q) => q.id === 'hh-q05'));
  if (!parsed.ok || parsed.value.lockType !== 'bone-ordering') throw new Error('hh-q05 not parsed');
  return parsed.value;
}

function specOf(questionId: string, steps: readonly string[]) {
  const { payload, hintEffect } = mapBoneOrderingPayload(questionId, steps);
  return { questionId, lockType: 'bone-ordering', payload, evidenceRefs: ['c1'], hintEffect };
}

describe('mapBoneOrderingPayload (hh-q05)', () => {
  it('assigns one item ID per step, keyOrder in authoring order, hint pinned to keyOrder[0]', () => {
    const q = hhQ05();
    const mapped = mapBoneOrderingPayload(q.id, q.steps);
    const ids = [0, 1, 2, 3].map((i) => `hh-q05-step-${i}`);
    expect(mapped.payload).toEqual({ itemIds: ids, keyOrder: ids });
    expect(mapped.hintEffect).toEqual({ kind: 'lock-first-bone', boneId: 'hh-q05-step-0' });
  });

  it('the real judge accepts the mapped payload with the correct submission', () => {
    const q = hhQ05();
    const { payload } = mapBoneOrderingPayload(q.id, q.steps);
    expect(judge(payload, { order: payload.keyOrder }, null)).toBe('correct');
    expect(judge(payload, { order: [...payload.keyOrder].reverse() }, null)).toBe('wrong');
  });

  it('content makes step text addressable by item ID', () => {
    const q = hhQ05();
    const entry = buildContentEntry(q, maps, q.id);
    expect(entry.options).toEqual({
      'hh-q05-step-0': 'Right atrium',
      'hh-q05-step-1': 'Tricuspid valve',
      'hh-q05-step-2': 'Right ventricle',
      'hh-q05-step-3': 'Pulmonary valve',
    });
    expect(entry.excerpts.every((e) => e.chunkId !== '' && e.optionId === undefined)).toBe(true);
  });
});

describe('authored lock-first-bone hint (31.10)', () => {
  const withHint = (hint: unknown) => {
    const raw = heart.questions.find((q) => q.id === 'hh-q05');
    const parsed = parseAuthoringQuestion({ ...raw, hint });
    if (!parsed.ok || parsed.value.lockType !== 'bone-ordering') throw new Error('hh-q05 not parsed');
    return parsed.value;
  };
  const map = (q: ReturnType<typeof hhQ05>) => mapAuthoringQuestionToSpec(q, maps, q.id, 'Blood path');

  it('rejects a disagreeing hint with hint-mismatch', () => {
    for (const boneId of ['hh-q05-step-1', 'Tricuspid valve', 'nope']) {
      const q = withHint({ kind: 'lock-first-bone', boneId });
      expect(map(q)).toEqual({ ok: false, error: { kind: 'hint-mismatch', questionId: 'hh-q05' } });
    }
    expect(mapBoneOrderingPayload('q', ['a', 'b', 'c'], 'b')).toBeNull();
  });

  it('accepts an agreeing hint (item ID or first step text) and an absent hint', () => {
    const expected = { kind: 'lock-first-bone', boneId: 'hh-q05-step-0' };
    for (const boneId of ['hh-q05-step-0', 'Right atrium']) {
      const r = map(withHint({ kind: 'lock-first-bone', boneId }));
      expect(r.ok && r.value.spec.hintEffect).toEqual(expected);
    }
    const absent = map(hhQ05());
    expect(absent.ok && absent.value.spec.hintEffect).toEqual(expected);
  });

  it('every bone-ordering question in samples and eval/dev still maps', () => {
    const sources = [
      ...['https', 'human-heart', 'printing-press'].map((n) => ({
        file: `${root}/samples/questions/${n}.json`,
        notesDir: `${root}/samples`,
      })),
      ...[1, 3, 4, 5, 7, 8, 9, 10].map((n) => ({
        file: fs
          .readdirSync(`${root}/eval/dev/questions`)
          .map((f) => `${root}/eval/dev/questions/${f}`)
          .find((f) => f.includes(`/dev-${String(n).padStart(2, '0')}-`))!,
        notesDir: `${root}/eval/dev/notes`,
      })),
    ];
    let count = 0;
    for (const { file, notesDir } of sources) {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { notes: string; questions: Record<string, unknown>[] };
      const docMaps = buildDocumentChunkMaps(fs.readFileSync(`${notesDir}/${doc.notes}`, 'utf8'));
      for (const raw of doc.questions.filter((q) => q.lockType === 'bone-ordering')) {
        const parsed = parseAuthoringQuestion(raw);
        if (!parsed.ok) throw new Error(`${String(raw.id)} not parsed`);
        const r = mapAuthoringQuestionToSpec(parsed.value, docMaps, String(raw.id), 'Title');
        expect(r.ok, String(raw.id)).toBe(true);
        count += 1;
      }
    }
    expect(count).toBe(11);
  });
});

describe('bone-ordering manifest schema and hint narrowing', () => {
  it('accepts the mapped hh-q05 spec', () => {
    const q = hhQ05();
    expect(QuestionSpecSchema.safeParse(specOf(q.id, q.steps)).success).toBe(true);
  });

  it('rejects a keyOrder that is not a permutation of itemIds', () => {
    const schema = payloadSchemaFor('bone-ordering');
    expect(schema?.safeParse({ itemIds: ['a', 'b', 'c'], keyOrder: ['a', 'b', 'x'] }).success).toBe(false);
    expect(schema?.safeParse({ itemIds: ['a', 'b', 'c'], keyOrder: ['a', 'b', 'b'] }).success).toBe(false);
    expect(schema?.safeParse({ itemIds: ['a', 'b', 'c'], keyOrder: ['c', 'a', 'b'] }).success).toBe(true);
  });

  it('rejects a lock-first-bone hint naming an unknown item and other hint kinds', () => {
    const base = specOf('q', ['a', 'b', 'c']);
    expect(
      QuestionSpecSchema.safeParse({ ...base, hintEffect: { kind: 'lock-first-bone', boneId: 'nope' } }).success,
    ).toBe(false);
    expect(
      QuestionSpecSchema.safeParse({ ...base, hintEffect: { kind: 'remove-option', optionId: 'q-step-0' } }).success,
    ).toBe(false);
    expect(QuestionSpecSchema.safeParse({ ...base, hintEffect: null }).success).toBe(true);
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property
  // **Validates: Requirements 22.1, 22.8**
  it('any 3 to 5 steps map to a payload the schema accepts and the judge solves', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 3, maxLength: 5 }),
        fc.string({ minLength: 1 }),
        (steps, id) => {
          const spec = specOf(id, steps);
          expect(QuestionSpecSchema.safeParse(spec).success).toBe(true);
          expect(spec.payload.keyOrder).toEqual(spec.payload.itemIds);
          expect(judge(spec.payload, { order: spec.payload.keyOrder }, spec.hintEffect)).toBe('correct');
        },
      ),
    );
  });
});
