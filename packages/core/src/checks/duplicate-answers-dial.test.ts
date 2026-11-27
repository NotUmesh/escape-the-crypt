import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { parseAuthoringQuestion } from '../authoring/parse';
import { buildDocumentChunkMaps, mapAuthoringQuestionToSpec } from '../mapper/manifest-mapper';
import type { QuestionSpec } from '../runtime/manifest-types';
import { answerKeysOf, answerKeysOfAuthoring, duplicateAnswerScan, keyedSpec } from './duplicate-answers';

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

interface RealDial {
  readonly question: CombinationDialAuthoringQuestion;
  readonly notes: string;
}

function loadRealDials(): RealDial[] {
  const out: RealDial[] = [];
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
        out.push({ question: parsed.value, notes });
      }
    }
  }
  return out;
}

const amount = fc.integer({ min: -99999, max: 99999 }).map((t) => t / 10);
const unit = fc.stringMatching(/^[a-z]{3,8}$/);
type Shape = { kind: 'exact'; v: number } | { kind: 'range'; lo: number; hi: number } | { kind: 'template'; a: number; b: number };
const shape: fc.Arbitrary<Shape> = fc.oneof(
  amount.map((v): Shape => ({ kind: 'exact', v })),
  fc.tuple(amount, amount).map(([a, b]): Shape => ({ kind: 'range', lo: Math.min(a, b), hi: Math.max(a, b) })),
  fc.tuple(amount, amount).map(([a, b]): Shape => ({ kind: 'template', a, b })),
);
const equalValue = (s: Shape): number => (s.kind === 'template' ? s.a - s.b : s.kind === 'exact' ? s.v : 0);

const authoring = (s: Shape, units: string) => ({
  lockType: 'combination-dial' as const,
  units,
  answer:
    s.kind === 'exact'
      ? { kind: 'exact', value: s.v }
      : s.kind === 'range'
        ? { kind: 'range', min: s.lo, max: s.hi }
        // The authored value is deliberately wrong: the key must use the recomputed one.
        : { kind: 'template', template: 'difference', inputs: [s.a, s.b], value: 12345.678 },
});

/** The same answer as the mapper would publish it: a template becomes its computed exact value. */
function published(id: string, s: Shape, units: string): QuestionSpec {
  const payload =
    s.kind === 'range'
      ? { kind: 'range', min: s.lo, max: s.hi, unit: units }
      : { kind: 'exact', exactValue: equalValue(s), unit: units };
  return { questionId: id, lockType: 'combination-dial', payload, evidenceRefs: ['c1'], hintEffect: null } as unknown as QuestionSpec;
}

const reported = (failures: readonly { checkId: string }[]) =>
  failures.filter((f) => f.checkId === 'duplicate-answer-in-room').length;

const scanAuthoring = (a: Shape, ua: string, b: Shape, ub: string) =>
  duplicateAnswerScan([
    { conceptId: 'c1', questionId: 'q1', keys: answerKeysOfAuthoring(authoring(a, ua)) },
    { conceptId: 'c2', questionId: 'q2', keys: answerKeysOfAuthoring(authoring(b, ub)) },
  ]);
const scanPublished = (a: Shape, ua: string, b: Shape, ub: string) =>
  duplicateAnswerScan([
    keyedSpec('c1', published('q1', a, ua), undefined),
    keyedSpec('c2', published('q2', b, ub), undefined),
  ]);

describe('combination-dial duplicate-answer keys', () => {
  // Feature: generation-and-evaluation, Property 5.33.11: dials with equal normalised value and unit (or low-high unit) clash across concepts; different ones do not (design numbers no duplicate-answer property)
  // **Validates: Requirements 22.4, 22.5, 12.2, 16.3**
  it('reports a clash across concepts exactly when value and unit are equal', () => {
    fc.assert(
      fc.property(shape, shape, unit, unit, (a, b, ua, ub) => {
        expect(reported(scanAuthoring(a, ua, a, ` ${ua.toUpperCase()} `))).toBe(2);
        expect(reported(scanPublished(a, ua, a, ` ${ua.toUpperCase()} `))).toBe(2);

        const keyA = answerKeysOfAuthoring(authoring(a, ua))[0];
        const keyB = answerKeysOfAuthoring(authoring(b, ub))[0];
        fc.pre(keyA !== keyB);
        expect(reported(scanAuthoring(a, ua, b, ub))).toBe(0);
        expect(reported(scanPublished(a, ua, b, ub))).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('writes one canonical key per value, range and template', () => {
    expect(answerKeysOfAuthoring(authoring({ kind: 'exact', v: 1200 }, ' Years '))).toEqual(['1200 years']);
    expect(answerKeysOfAuthoring(authoring({ kind: 'range', lo: 3, hi: 4.5 }, 'km'))).toEqual(['3-4.5 km']);
    expect(answerKeysOfAuthoring(authoring({ kind: 'template', a: 10, b: 4 }, 'km'))).toEqual(['6 km']);
    expect(answerKeysOf(published('q', { kind: 'exact', v: 1200 }, 'Years'), undefined)).toEqual(['1200 years']);
  });

  it('gives no key to a tolerance payload, extra keys or a reversed range', () => {
    const spec = (payload: unknown) =>
      ({ questionId: 'q', lockType: 'combination-dial', payload, evidenceRefs: ['c1'], hintEffect: null }) as unknown as QuestionSpec;
    expect(answerKeysOf(spec({ kind: 'tolerance', value: 5, tolerance: 1, unit: 'km' }), undefined)).toEqual([]);
    expect(answerKeysOf(spec({ kind: 'exact', exactValue: 5, unit: 'km', extra: 1 }), undefined)).toEqual([]);
    expect(answerKeysOf(spec({ kind: 'range', min: 9, max: 1, unit: 'km' }), undefined)).toEqual([]);
  });

  it('gives the authoring key and the published key for all 26 real dial questions the same value', () => {
    const real = loadRealDials();
    expect(real).toHaveLength(26);
    for (const d of real) {
      const r = mapAuthoringQuestionToSpec(d.question, buildDocumentChunkMaps(d.notes), d.question.id, 'Concept');
      if (!r.ok) throw new Error(`unmapped ${d.question.id}`);
      const authoringKeys = answerKeysOfAuthoring(d.question);
      expect(authoringKeys, d.question.id).toHaveLength(1);
      expect(answerKeysOf(r.value.spec, r.value.content), d.question.id).toEqual(authoringKeys);
    }
  });

  it('leaves bone-ordering and bound-threads without keys', () => {
    expect(answerKeysOfAuthoring({ lockType: 'bone-ordering' })).toEqual([]);
    expect(answerKeysOfAuthoring({ lockType: 'bound-threads' })).toEqual([]);
  });
});
