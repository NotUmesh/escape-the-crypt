import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import { runChecks } from '../checks/run-checks';
import { CryptManifestSchema, QuestionSpecSchema } from '../runtime/manifest-schema';
import { buildManifest } from '../test-support/manifest-fixture';
import type { Chunk } from '../types';
import {
  ALLOWED_TEMPLATES,
  checkDialRangePrompt,
  checkNumberNotInQuote,
  checkRangeNotInQuote,
  checkTemplateInputNotInQuote,
  checkTemplateNotAllowlisted,
  checkTemplateValueMismatch,
  combinationDialChecks,
  computeTemplate,
} from './combination-dial-checks';
import { mapCombinationDialPayload } from './combination-dial';

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

const ids = (failures: readonly { checkId: string }[]): string[] => failures.map((f) => f.checkId);

function contextFor(notes: string): QuoteContext {
  const chunks = chunkDocument({ sourceType: 'paste', text: notes, originalText: notes });
  const paragraphChunkIds = new Map<number, string>();
  for (const c of chunks) {
    if (c.location.sourceType === 'paste' && !paragraphChunkIds.has(c.location.paragraphNumber)) {
      paragraphChunkIds.set(c.location.paragraphNumber, c.id);
    }
  }
  return { chunks: new Map<string, Chunk>(chunks.map((c) => [c.id, c])), paragraphChunkIds };
}

const QUOTE = 'The crypt held 120 candles and 45 bones, and the vault cost 150,000 coins.';
const STATED = [120, 45, 150000] as const;
const context = contextFor(QUOTE);
const stated = fc.constantFrom(...STATED);
const absent = fc.integer({ min: 0, max: 1_000_000 }).filter((n) => !(STATED as readonly number[]).includes(n));

type Answer = CombinationDialAuthoringQuestion['answer'];
function dial(answer: Answer, prompt = 'How many candles did the crypt hold?'): CombinationDialAuthoringQuestion {
  return {
    id: 'q1',
    conceptId: 'c1',
    role: 'primary',
    lockType: 'combination-dial',
    prompt,
    answer,
    units: 'candles',
    evidence: [{ paragraph: 1, quote: QUOTE }],
    explanation: 'The notes state it.',
  };
}

const intIn = fc.integer({ min: -500, max: 500 });

describe('combination-dial properties', () => {
  // Feature: generation-and-evaluation, Property 23: A stated number or range endpoint not present in any resolved quote is always rejected
  // **Validates: Requirements 22.4**
  describe('Property 23', () => {
    it('an exact value absent from the quote is rejected; a stated one passes', () => {
      fc.assert(
        fc.property(absent, (value) => {
          expect(ids(checkNumberNotInQuote(dial({ kind: 'exact', value }), context))).toEqual(['number-not-in-quote']);
        }),
      );
      fc.assert(
        fc.property(stated, (value) => {
          expect(combinationDialChecks(dial({ kind: 'exact', value }), context)).toEqual([]);
        }),
      );
    });

    it('a range with an endpoint absent from the quote is rejected', () => {
      fc.assert(
        fc.property(fc.oneof(stated, absent), absent, fc.boolean(), (other, miss, missIsMin) => {
          const [min, max] = missIsMin ? [miss, other] : [other, miss];
          expect(ids(checkRangeNotInQuote(dial({ kind: 'range', min, max }), context))).toEqual(['range-not-in-quote']);
        }),
      );
    });

    it('a template input absent from the quote is rejected', () => {
      fc.assert(
        fc.property(absent, stated, fc.boolean(), (miss, other, first) => {
          const inputs = first ? [miss, other] : [other, miss];
          const answer: Answer = { kind: 'template', template: 'difference', inputs, value: inputs[0]! - inputs[1]! };
          expect(ids(checkTemplateInputNotInQuote(dial(answer), context))).toEqual(['template-input-not-in-quote']);
        }),
      );
    });
  });

  // Feature: generation-and-evaluation, Property 24: Only the two allowlisted templates are ever accepted
  // **Validates: Requirements 22.5**
  it('Property 24: a template name outside the allowlist is rejected, the two listed names pass', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (name) => {
        const answer = { kind: 'template', template: name, inputs: [1, 2], value: 0 } as unknown as Answer;
        const expected = (ALLOWED_TEMPLATES as readonly string[]).includes(name) ? [] : ['template-not-allowlisted'];
        expect(ids(checkTemplateNotAllowlisted(dial(answer)))).toEqual(expected);
      }),
    );
    expect(ALLOWED_TEMPLATES).toEqual(['difference', 'percent-change']);
  });

  // Feature: generation-and-evaluation, Property 25: A template's computed value must match code's own computation
  // **Validates: Requirements 22.5, 22.6**
  it('Property 25: the claimed value passes only when it equals the code-computed value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_TEMPLATES),
        intIn,
        intIn.filter((n) => n !== 0),
        fc.integer({ min: 1, max: 1000 }),
        fc.boolean(),
        (template, x, y, delta, sign) => {
          const inputs = template === 'percent-change' ? [y, x] : [x, y];
          const computed = computeTemplate(template, inputs)!;
          expect(checkTemplateValueMismatch(dial({ kind: 'template', template, inputs, value: computed }))).toEqual([]);
          const wrong = computed + (sign ? delta : -delta);
          expect(ids(checkTemplateValueMismatch(dial({ kind: 'template', template, inputs, value: wrong })))).toEqual([
            'template-value-mismatch',
          ]);
        },
      ),
    );
  });

  // Feature: generation-and-evaluation, Property 27: A range answer's prompt never asks for more than one value
  // **Validates: Requirements 22.7**
  it('Property 27: a plural-value range prompt fails, a one-value prompt and non-range answers pass', () => {
    const plural = fc.constantFrom('both', 'two values', 'the range', 'endpoints', 'minimum and maximum', 'lower and upper');
    const range: Answer = { kind: 'range', min: 45, max: 120 };
    fc.assert(
      fc.property(plural, fc.boolean(), (phrase, upper) => {
        const p = `Give ${upper ? phrase.toUpperCase() : phrase} for the crypt.`;
        expect(ids(checkDialRangePrompt(dial(range, p)))).toEqual(['dial-range-prompt']);
        expect(checkDialRangePrompt(dial({ kind: 'exact', value: 45 }, p))).toEqual([]);
      }),
    );
    fc.assert(
      fc.property(fc.constantFrom('a year', 'a count', 'one number', 'a typical figure'), (what) => {
        expect(checkDialRangePrompt(dial(range, `State ${what} in the stated span.`))).toEqual([]);
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch
  // **Validates: Requirements 22.8**
  describe('Property 28 (combination-dial part)', () => {
    const payloadArb = fc.oneof(
      fc.integer({ min: 0, max: 9999 }).map((t) => ({ kind: 'exact', exactValue: t / 10, unit: 'candles' })),
      fc.tuple(fc.nat({ max: 999 }), fc.nat({ max: 999 })).map(([a, b]) => ({ kind: 'range', min: Math.min(a, b), max: Math.max(a, b), unit: 'years' })),
    );
    const hints = fc.constantFrom(
      { kind: 'reveal-digit', position: 0 },
      { kind: 'remove-option', optionId: 'o' },
      { kind: 'lock-first-bone', boneId: 'b' },
      { kind: 'tie-thread', pair: ['l', 'r'] as [string, string] },
      { kind: 'reveal-first-letter', firstLetter: 'a', length: 3 },
    );
    const spec = (payload: unknown, hintEffect: unknown) => ({
      questionId: 'q',
      lockType: 'combination-dial',
      payload,
      evidenceRefs: ['c1'],
      hintEffect,
    });

    it('accepts a payload with a null hint and rejects any non-null hint', () => {
      fc.assert(
        fc.property(payloadArb, hints, (payload, hint) => {
          expect(QuestionSpecSchema.safeParse(spec(payload, null)).success).toBe(true);
          expect(QuestionSpecSchema.safeParse(spec(payload, hint)).success).toBe(false);
        }),
      );
    });

    it('rejects a tolerance payload and a reversed range', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 99 }), (n) => {
          const tolerance = { kind: 'tolerance', value: n, tolerance: 1, unit: 'steps' };
          expect(QuestionSpecSchema.safeParse(spec(tolerance, null)).success).toBe(false);
          const reversed = { kind: 'range', min: n + 1, max: n, unit: 'steps' };
          expect(QuestionSpecSchema.safeParse(spec(reversed, null)).success).toBe(false);
        }),
      );
    });
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property: the mapped payload equals the code-computed value and the manifest accepts it
  // **Validates: Requirements 22.4, 22.5, 22.6, 22.8**
  it('mapper: exact, range and template answers map to the code-computed value and are accepted', () => {
    const base = buildManifest({ lockTypes: ['combination-dial'], rooms: 1, conceptsPerRoom: 1, alternates: false, finalDoorQuestions: 0 });
    const tenths = fc.integer({ min: 0, max: 9999 }).map((t) => t / 10);
    const answerArb: fc.Arbitrary<Answer> = fc.oneof(
      tenths.map((value): Answer => ({ kind: 'exact', value })),
      fc.tuple(tenths, tenths).map(([a, b]): Answer => ({ kind: 'range', min: Math.min(a, b), max: Math.max(a, b) })),
      fc
        .tuple(fc.constantFrom(...ALLOWED_TEMPLATES), intIn, intIn.filter((n) => n !== 0), fc.integer())
        .map(([template, x, y, junk]): Answer => ({ kind: 'template', template, inputs: [x, y], value: junk })),
    );
    fc.assert(
      fc.property(answerArb, (answer) => {
        const mapped = mapCombinationDialPayload(answer, 'candles');
        if (mapped === null) {
          expect(answer.kind).toBe('template');
          return;
        }
        expect(mapped.hintEffect).toBeNull();
        if (answer.kind === 'exact') expect(mapped.payload).toEqual({ kind: 'exact', exactValue: answer.value, unit: 'candles' });
        if (answer.kind === 'range') expect(mapped.payload).toEqual({ kind: 'range', min: answer.min, max: answer.max, unit: 'candles' });
        if (answer.kind === 'template') {
          // The authored value (junk) is ignored: code recomputes it.
          expect(mapped.payload).toEqual({ kind: 'exact', exactValue: computeTemplate(answer.template, answer.inputs), unit: 'candles' });
        }
        const slot = base.rooms[0]!.lockSlots[0]!;
        const manifest = {
          ...base,
          rooms: [{ ...base.rooms[0]!, lockSlots: [{ ...slot, primaryQuestion: { ...slot.primaryQuestion, payload: mapped.payload, hintEffect: null } }] }],
        };
        expect(CryptManifestSchema.safeParse(manifest).success).toBe(true);
      }),
    );
  });
});

interface Fixture {
  id: string;
  expectedCatch: string;
  notes: string;
  notesDir?: string;
  question: Record<string, unknown>;
}

// Feature: generation-and-evaluation, Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every code:* adversarial fixture of those types fails with exactly its expected Check_ID
// **Validates: Requirements 22.9**
describe('Property 29 (combination-dial part)', () => {
  it('every dev and sample combination-dial question passes Code_Checks', () => {
    let count = 0;
    for (const [qdir, ndir] of [
      ['eval/dev/questions', 'eval/dev/notes'],
      ['samples/questions', 'samples'],
    ] as const) {
      for (const f of fs.readdirSync(`${root}/${qdir}`)) {
        const json = JSON.parse(fs.readFileSync(`${root}/${qdir}/${f}`, 'utf8')) as {
          notes: string;
          questions: Record<string, unknown>[];
        };
        const ctx = contextFor(fs.readFileSync(`${root}/${ndir}/${json.notes}`, 'utf8'));
        for (const raw of json.questions.filter((q) => q['lockType'] === 'combination-dial')) {
          const parsed = parseAuthoringQuestion(raw);
          expect(parsed.ok, `${f}:${String(raw['id'])} parses`).toBe(true);
          if (!parsed.ok) continue;
          count += 1;
          expect(ids(runChecks({ question: parsed.value, ...ctx })), `${f}:${String(raw['id'])}`).toEqual([]);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('every code:* combination-dial adversarial fixture fails with exactly its expected Check_ID', () => {
    const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as { fixtures: Fixture[] };
    const fixtures = all.fixtures.filter((f) => f.question['lockType'] === 'combination-dial' && f.expectedCatch.startsWith('code:'));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
      const ctx = contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
      // Raw object: the schema rejects adv-08's `elasticity` template and `expression` key, so only the checks can name it.
      const raw = f.question as unknown as CombinationDialAuthoringQuestion;
      expect(ids(combinationDialChecks(raw, ctx)), f.id).toEqual([f.expectedCatch.slice('code:'.length)]);
    }
  });
});
