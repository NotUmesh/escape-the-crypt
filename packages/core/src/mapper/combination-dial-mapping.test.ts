import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { parseAuthoringQuestion } from '../authoring/parse';
import { judge, mapCombinationDialPayload, type CombinationDialQuestion } from '../locks/combination-dial';
import { computeTemplate } from '../locks/combination-dial-checks';
import { QuestionSpecSchema, payloadSchemaFor } from '../runtime/manifest-schema';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from './manifest-mapper';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readdirSync(path: string): string[];
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

interface Fixture {
  readonly question: CombinationDialAuthoringQuestion;
  readonly notes: string;
  readonly file: string;
}

function loadDials(): Fixture[] {
  const out: Fixture[] = [];
  const dirs: [string, string][] = [
    ['eval/dev/questions', 'eval/dev/notes'],
    ['samples/questions', 'samples'],
  ];
  for (const [qDir, nDir] of dirs) {
    for (const f of fs.readdirSync(`${root}/${qDir}`)) {
      const json = JSON.parse(fs.readFileSync(`${root}/${qDir}/${f}`, 'utf8')) as {
        notes: string;
        questions: Record<string, unknown>[];
      };
      const notes = fs.readFileSync(`${root}/${nDir}/${json.notes}`, 'utf8');
      for (const raw of json.questions) {
        if (raw['lockType'] !== 'combination-dial') continue;
        const parsed = parseAuthoringQuestion(raw);
        if (!parsed.ok || parsed.value.lockType !== 'combination-dial') throw new Error(`unparsed ${String(raw['id'])}`);
        out.push({ question: parsed.value, notes, file: `${qDir}/${f}` });
      }
    }
  }
  return out;
}

const dials = loadDials();
const byId = (id: string): Fixture => {
  const f = dials.find((d) => d.question.id === id);
  if (f === undefined) throw new Error(`missing fixture ${id}`);
  return f;
};

/** The submission a learner types for a correct answer. */
function correctSubmission(q: CombinationDialAuthoringQuestion): string {
  const a = q.answer;
  if (a.kind === 'exact') return String(a.value);
  if (a.kind === 'range') return String(a.min);
  return String(computeTemplate(a.template, a.inputs));
}

describe('mapCombinationDialPayload (units)', () => {
  it('maps hh-q10 (exact) and the real judge accepts the stated value', () => {
    const q = byId('hh-q10').question;
    const mapped = mapCombinationDialPayload(q.answer, q.units);
    expect(mapped).toEqual({ payload: { kind: 'exact', exactValue: 4, unit: 'chambers' }, hintEffect: null });
    const payload = mapped?.payload as CombinationDialQuestion;
    expect(judge(payload, { rawInput: '4' }, null)).toBe('correct');
    expect(judge(payload, { rawInput: '5' }, null)).toBe('wrong');
  });

  it('maps hh-q11 (range) and the real judge accepts values inside it', () => {
    const q = byId('hh-q11').question;
    const mapped = mapCombinationDialPayload(q.answer, q.units);
    expect(mapped).toEqual({
      payload: { kind: 'range', min: 60, max: 100, unit: 'beats per minute' },
      hintEffect: null,
    });
    const payload = mapped?.payload as CombinationDialQuestion;
    for (const ok of ['60', '72', '100']) expect(judge(payload, { rawInput: ok }, null)).toBe('correct');
    expect(judge(payload, { rawInput: '101' }, null)).toBe('wrong');
  });

  it('maps a template to the value computed by code, never the authored value', () => {
    const q = byId('d06-q07').question;
    expect(q.answer.kind).toBe('template');
    const lying = { ...q.answer, value: 999 } as CombinationDialAuthoringQuestion['answer'];
    const mapped = mapCombinationDialPayload(lying, q.units);
    expect(mapped?.payload).toEqual({ kind: 'exact', exactValue: 20, unit: 'cups a day' });
    expect(judge(mapped?.payload as CombinationDialQuestion, { rawInput: '20' }, null)).toBe('correct');
  });

  it('computes percent-change in code and the judge accepts one decimal place', () => {
    const answer: CombinationDialAuthoringQuestion['answer'] = {
      kind: 'template',
      template: 'percent-change',
      inputs: [30, 40],
      value: 0,
    };
    const mapped = mapCombinationDialPayload(answer, 'percent');
    expect(judge(mapped?.payload as CombinationDialQuestion, { rawInput: '33.3' }, null)).toBe('correct');
  });

  it('returns null for a blank unit, reversed range, or uncomputable template', () => {
    expect(mapCombinationDialPayload({ kind: 'exact', value: 1 }, '  ')).toBeNull();
    expect(mapCombinationDialPayload({ kind: 'range', min: 9, max: 1 }, 'x')).toBeNull();
    expect(
      mapCombinationDialPayload({ kind: 'template', template: 'percent-change', inputs: [0, 5], value: 0 }, 'x'),
    ).toBeNull();
  });

  it('never produces tolerance or a hint', () => {
    for (const { question } of dials) {
      const mapped = mapCombinationDialPayload(question.answer, question.units);
      expect(mapped?.hintEffect).toBeNull();
      expect(mapped?.payload.kind).not.toBe('tolerance');
    }
  });
});

describe('mapAuthoringQuestionToSpec for every real combination-dial question', () => {
  it('covers all 26 dev and sample dial questions', () => {
    expect(dials).toHaveLength(26);
  });

  it.each(dials.map((d) => [d.question.id, d] as const))('%s maps to a schema-valid spec the judge solves', (_id, d) => {
    const maps = buildDocumentChunkMaps(d.notes);
    const r = mapAuthoringQuestionToSpec(d.question, maps, d.question.id, 'Concept');
    expect(r.ok, d.file).toBe(true);
    if (!r.ok) return;
    const { spec } = r.value;
    expect(spec.lockType).toBe('combination-dial');
    expect(spec.hintEffect).toBeNull();
    expect(QuestionSpecSchema.safeParse(spec).success).toBe(true);
    expect(judge(spec.payload as CombinationDialQuestion, { rawInput: correctSubmission(d.question) }, null)).toBe(
      'correct',
    );
  });
});

describe('combination-dial manifest schema and hint narrowing', () => {
  const base = {
    questionId: 'q',
    lockType: 'combination-dial',
    payload: { kind: 'exact', exactValue: 4, unit: 'chambers' },
    evidenceRefs: ['c1'],
    hintEffect: null,
  };
  const parse = (over: Record<string, unknown>) => QuestionSpecSchema.safeParse({ ...base, ...over }).success;

  it('accepts exact and range payloads and rejects tolerance, extra keys and reversed ranges', () => {
    const schema = payloadSchemaFor('combination-dial');
    expect(schema?.safeParse(base.payload).success).toBe(true);
    expect(schema?.safeParse({ kind: 'range', min: 1, max: 2, unit: 'x' }).success).toBe(true);
    expect(schema?.safeParse({ kind: 'range', min: 3, max: 2, unit: 'x' }).success).toBe(false);
    expect(schema?.safeParse({ kind: 'tolerance', value: 1, tolerance: 1, unit: 'x' }).success).toBe(false);
    expect(schema?.safeParse({ ...base.payload, extra: 1 }).success).toBe(false);
    expect(schema?.safeParse({ ...base.payload, unit: '' }).success).toBe(false);
  });

  it('narrowHint rejects every non-null hint for the dial', () => {
    expect(parse({})).toBe(true);
    expect(parse({ hintEffect: { kind: 'reveal-digit', position: 0 } })).toBe(false);
    expect(parse({ hintEffect: { kind: 'remove-option', optionId: 'a' } })).toBe(false);
    expect(parse({ hintEffect: { kind: 'reveal-first-letter', firstLetter: 'a', length: 1 } })).toBe(false);
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property
  // **Validates: Requirements 22.4, 22.5, 22.6, 22.8**
  it('any exact, range or template answer maps to a schema-valid spec the judge solves', () => {
    const tenth = fc.integer({ min: -100000, max: 100000 }).map((n) => n / 10);
    const unit = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '');
    const answer: fc.Arbitrary<CombinationDialAuthoringQuestion['answer']> = fc.oneof(
      tenth.map((value) => ({ kind: 'exact', value }) as const),
      fc.tuple(tenth, tenth).map(([a, b]) => ({ kind: 'range', min: Math.min(a, b), max: Math.max(a, b) }) as const),
      fc
        .tuple(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }))
        .map(([a, b]): CombinationDialAuthoringQuestion['answer'] => ({
          kind: 'template',
          template: 'difference',
          inputs: [a, b],
          value: 0,
        })),
      fc
        .tuple(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 5000 }))
        .map(([a, b]): CombinationDialAuthoringQuestion['answer'] => ({
          kind: 'template',
          template: 'percent-change',
          inputs: [a, b],
          value: 0,
        })),
    );
    fc.assert(
      fc.property(answer, unit, (a, u) => {
        const mapped = mapCombinationDialPayload(a, u);
        if (mapped === null) throw new Error('unmapped');
        const spec = {
          questionId: 'q',
          lockType: 'combination-dial',
          payload: mapped.payload,
          evidenceRefs: ['c1'],
          hintEffect: mapped.hintEffect,
        };
        expect(QuestionSpecSchema.safeParse(spec).success).toBe(true);
        const typed =
          a.kind === 'exact'
            ? String(a.value)
            : a.kind === 'range'
              ? String(a.min)
              : (Math.round((computeTemplate(a.template, a.inputs) ?? 0) * 10) / 10).toFixed(1);
        expect(judge(mapped.payload as CombinationDialQuestion, { rawInput: typed }, null)).toBe('correct');
      }),
    );
  });
});
