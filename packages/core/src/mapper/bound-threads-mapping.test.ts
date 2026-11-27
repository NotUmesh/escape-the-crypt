import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import { judge, mapBoundThreadsPayload } from '../locks/bound-threads';
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

function hhQ07(hint?: unknown) {
  const raw = heart.questions.find((q) => q.id === 'hh-q07');
  const parsed = parseAuthoringQuestion(hint === undefined ? raw : { ...raw, hint });
  if (!parsed.ok || parsed.value.lockType !== 'bound-threads') throw new Error('hh-q07 not parsed');
  return parsed.value;
}

function specOf(questionId: string, pairs: readonly { left: string; right: string }[]) {
  const mapped = mapBoundThreadsPayload(questionId, pairs);
  if (mapped === null) throw new Error('unmapped');
  return {
    questionId,
    lockType: 'bound-threads',
    payload: mapped.payload,
    evidenceRefs: ['c1'],
    hintEffect: mapped.hintEffect,
  };
}

describe('mapBoundThreadsPayload (hh-q07)', () => {
  it('assigns item IDs, keyPairs in authoring order, hint pinned to the first pair', () => {
    const q = hhQ07();
    const mapped = mapBoundThreadsPayload(q.id, q.pairs);
    expect(mapped?.payload).toEqual({
      leftIds: ['hh-q07-left-0', 'hh-q07-left-1', 'hh-q07-left-2'],
      rightIds: ['hh-q07-right-0', 'hh-q07-right-1', 'hh-q07-right-2'],
      keyPairs: [
        ['hh-q07-left-0', 'hh-q07-right-0'],
        ['hh-q07-left-1', 'hh-q07-right-1'],
        ['hh-q07-left-2', 'hh-q07-right-2'],
      ],
    });
    expect(mapped?.hintEffect).toEqual({ kind: 'tie-thread', pair: ['hh-q07-left-0', 'hh-q07-right-0'] });
  });

  it('the real judge accepts the mapped payload with the correct submission', () => {
    const q = hhQ07();
    const mapped = mapBoundThreadsPayload(q.id, q.pairs);
    if (mapped === null) throw new Error('unmapped');
    const { payload, hintEffect } = mapped;
    expect(judge(payload, { pairs: payload.keyPairs }, null)).toBe('correct');
    expect(judge(payload, { pairs: [...payload.keyPairs].reverse() }, hintEffect)).toBe('correct');
    const [a, b, c] = payload.keyPairs;
    expect(judge(payload, { pairs: [[a![0], b![1]], [b![0], a![1]], c!] }, null)).toBe('wrong');
  });

  it('pins an accepted authored hint to the matching keyPair, in either text order', () => {
    const q = hhQ07();
    const texts = [q.pairs[1]!.left, q.pairs[1]!.right] as const;
    const forward = mapBoundThreadsPayload(q.id, q.pairs, texts);
    const swapped = mapBoundThreadsPayload(q.id, q.pairs, [texts[1], texts[0]]);
    const pinned = { kind: 'tie-thread', pair: ['hh-q07-left-1', 'hh-q07-right-1'] };
    expect(forward?.hintEffect).toEqual(pinned);
    expect(swapped?.hintEffect).toEqual(pinned);
  });

  it('returns null for an authored hint that matches no authored pair', () => {
    const q = hhQ07();
    expect(mapBoundThreadsPayload(q.id, q.pairs, ['Aorta', 'Returns blood to the heart'])).toBeNull();
    expect(mapBoundThreadsPayload(q.id, q.pairs, ['nope', 'nope'])).toBeNull();
    expect(mapBoundThreadsPayload(q.id, [])).toBeNull();
  });

  it('content makes item text addressable by ID with one excerpt per pair', () => {
    const q = hhQ07();
    const entry = buildContentEntry(q, maps, q.id);
    expect(entry.options).toEqual({
      'hh-q07-left-0': 'Aorta',
      'hh-q07-left-1': 'Pulmonary artery',
      'hh-q07-left-2': 'Vena cava',
      'hh-q07-right-0': 'Carries blood to the body',
      'hh-q07-right-1': 'Carries blood to the lungs',
      'hh-q07-right-2': 'Returns blood to the heart',
    });
    expect(entry.excerpts).toHaveLength(3);
    expect(entry.excerpts.every((e) => e.chunkId !== '' && e.optionId === undefined)).toBe(true);
  });

  it('mapAuthoringQuestionToSpec rejects a disagreeing authored hint with hint-mismatch', () => {
    const q = hhQ07({ kind: 'tie-thread', pair: ['Aorta', 'Returns blood to the heart'] });
    const r = mapAuthoringQuestionToSpec(q, maps, q.id, 'Blood vessels');
    expect(r).toEqual({ ok: false, error: { kind: 'hint-mismatch', questionId: 'hh-q07' } });
  });

  it('mapAuthoringQuestionToSpec maps hh-q07 end to end, with and without an agreeing hint', () => {
    const q = hhQ07();
    const r = mapAuthoringQuestionToSpec(q, maps, q.id, 'Blood vessels');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.spec.lockType).toBe('bound-threads');
    expect(r.value.spec.hintEffect).toEqual({ kind: 'tie-thread', pair: ['hh-q07-left-0', 'hh-q07-right-0'] });
    expect(QuestionSpecSchema.safeParse(r.value.spec).success).toBe(true);
    const hinted = mapAuthoringQuestionToSpec(
      hhQ07({ kind: 'tie-thread', pair: ['Aorta', 'Carries blood to the body'] }),
      maps,
      q.id,
      'Blood vessels',
    );
    expect(hinted).toEqual(r);
  });
});

describe('bound-threads manifest schema and hint narrowing', () => {
  it('accepts the mapped hh-q07 spec', () => {
    const q = hhQ07();
    expect(QuestionSpecSchema.safeParse(specOf(q.id, q.pairs)).success).toBe(true);
  });

  it('rejects payloads that do not tie each ID exactly once', () => {
    const schema = payloadSchemaFor('bound-threads');
    const ok = { leftIds: ['l1', 'l2', 'l3'], rightIds: ['r1', 'r2', 'r3'], keyPairs: [['l1', 'r2'], ['l2', 'r1'], ['l3', 'r3']] };
    expect(schema?.safeParse(ok).success).toBe(true);
    expect(schema?.safeParse({ ...ok, keyPairs: [['l1', 'r1'], ['l2', 'r1'], ['l3', 'r3']] }).success).toBe(false);
    expect(schema?.safeParse({ ...ok, keyPairs: [['l1', 'r1'], ['l1', 'r2'], ['l3', 'r3']] }).success).toBe(false);
    expect(schema?.safeParse({ ...ok, keyPairs: [['l1', 'r1'], ['l2', 'r2'], ['l3', 'x']] }).success).toBe(false);
    expect(schema?.safeParse({ ...ok, keyPairs: [['l1', 'r1'], ['l2', 'r2']] }).success).toBe(false);
  });

  it('narrows tie-thread hints to a keyPair, in either order, and rejects other kinds', () => {
    const base = specOf('q', [
      { left: 'a', right: 'b' },
      { left: 'c', right: 'd' },
      { left: 'e', right: 'f' },
    ]);
    const parse = (hintEffect: unknown) => QuestionSpecSchema.safeParse({ ...base, hintEffect }).success;
    expect(parse({ kind: 'tie-thread', pair: ['q-left-1', 'q-right-1'] })).toBe(true);
    expect(parse({ kind: 'tie-thread', pair: ['q-right-1', 'q-left-1'] })).toBe(true);
    expect(parse({ kind: 'tie-thread', pair: ['q-left-0', 'q-right-1'] })).toBe(false);
    expect(parse({ kind: 'tie-thread', pair: ['nope', 'nope'] })).toBe(false);
    expect(parse({ kind: 'remove-option', optionId: 'q-left-0' })).toBe(false);
    expect(parse(null)).toBe(true);
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property
  // **Validates: Requirements 22.2, 22.8**
  it('any 3 or 4 pairs map to a payload the schema accepts and the judge solves', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ left: fc.string({ minLength: 1 }), right: fc.string({ minLength: 1 }) }), {
          minLength: 3,
          maxLength: 4,
        }),
        fc.string({ minLength: 1 }),
        (pairs, id) => {
          const spec = specOf(id, pairs);
          expect(QuestionSpecSchema.safeParse(spec).success).toBe(true);
          expect(judge(spec.payload, { pairs: spec.payload.keyPairs }, spec.hintEffect)).toBe('correct');
        },
      ),
    );
  });
});
