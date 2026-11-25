import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion, SeanceBoardAuthoringQuestion } from '../authoring/schema';
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

function heartQuestion(id: string): AuthoringQuestion {
  const raw = heart.questions.find((q) => q.id === id);
  const r = parseAuthoringQuestion(raw);
  if (!r.ok) throw new Error(`sample question ${id} rejected`);
  return r.value;
}

function seance(): SeanceBoardAuthoringQuestion {
  const q = heartQuestion('hh-q03');
  if (q.lockType !== 'seance-board') throw new Error('hh-q03 is not a séance question');
  return q;
}

function mapped(question: AuthoringQuestion, title: string | undefined = 'Title') {
  return mapAuthoringQuestionToSpec(question, maps, question.id, title);
}

describe('mapper content handoff', () => {
  it('rune cipher: question-level excerpts without optionId, evidenceRefs from the excerpts', () => {
    const result = mapped(heartQuestion('hh-q01'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { spec, content } = result.value;
    expect(content.options).toBeUndefined();
    expect(content.excerpts.length).toBeGreaterThan(0);
    for (const excerpt of content.excerpts) expect('optionId' in excerpt).toBe(false);
    const chunkIds = content.excerpts.map((e) => e.chunkId);
    for (const ref of spec.evidenceRefs) expect(chunkIds).toContain(ref);
    for (const id of chunkIds) expect(maps.chunks.has(id)).toBe(true);
  });

  it('séance board: one Option_Excerpt per option, in option order, from its own evidence', () => {
    const question = seance();
    const result = mapped(question);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { spec, content } = result.value;
    expect(content.excerpts.map((e) => e.optionId)).toEqual(question.options.map((o) => o.id));
    expect(content.options).toEqual(Object.fromEntries(question.options.map((o) => [o.id, o.text])));
    question.options.forEach((o, i) => {
      expect(content.excerpts[i]).toEqual({
        chunkId: maps.chunksByParagraph.get(o.evidence.paragraph),
        quote: o.evidence.quote,
        optionId: o.id,
      });
    });
    const chunkIds = content.excerpts.map((e) => e.chunkId);
    for (const ref of spec.evidenceRefs) expect(chunkIds).toContain(ref);
  });

  it('a present title fills concept', () => {
    const result = mapped(heartQuestion('hh-q01'), 'The valves');
    expect(result.ok && result.value.concept).toEqual({ conceptId: 'hh-c01', title: 'The valves' });
  });
});

describe('mapper content errors', () => {
  it('returns option-evidence-missing for a séance option without evidence, no spec or content', () => {
    const q = seance();
    const options = q.options.map((o, i) => (i === 1 ? { ...o, evidence: undefined } : o));
    const broken = { ...q, options } as unknown as AuthoringQuestion;
    const result = mapped(broken);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'option-evidence-missing', questionId: 'hh-q03', conceptId: q.conceptId },
    });
    expect('value' in result).toBe(false);
  });

  it('returns content-schema-invalid when the entry fails its schema, no spec or content', () => {
    const q = seance();
    // An empty option ID passes the Code_Checks but not the content schema.
    const target = q.options.findIndex((o) => o.id !== q.answer);
    const options = q.options.map((o, i) => (i === target ? { ...o, id: '' } : o));
    const result = mapped({ ...q, options } as unknown as AuthoringQuestion);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'content-schema-invalid', questionId: 'hh-q03', conceptId: q.conceptId },
    });
    expect('value' in result).toBe(false);
  });

  it.each([undefined, '', '   '])('returns concept-label-missing for title %j, no spec or content', (title) => {
    const q = heartQuestion('hh-q01');
    const result = mapAuthoringQuestionToSpec(q, maps, 'hh-q01', title);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'concept-label-missing', questionId: 'hh-q01', conceptId: q.conceptId },
    });
    expect('value' in result).toBe(false);
  });

  it('does not throw on malformed séance options', () => {
    const q = seance();
    for (const options of [undefined, null, [null], [{}], 'x']) {
      const broken = { ...q, options } as unknown as AuthoringQuestion;
      expect(() => mapped(broken)).not.toThrow();
      expect(mapped(broken).ok).toBe(false);
    }
  });
});
