import { describe, expect, it } from 'vitest';
import type { CombinationDialAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import type { Chunk } from '../types';
import {
  checkDialRangePrompt,
  checkMissingUnits,
  checkModelWrittenExpression,
  checkNumberNotInQuote,
  checkRangeNotInQuote,
  checkTemplateInputNotInQuote,
  checkTemplateNotAllowlisted,
  checkTemplateValueMismatch,
  combinationDialChecks,
  computeTemplate,
  numberAppearsVerbatim,
} from './combination-dial-checks';

// packages/core compiles without Node types, so load Node modules dynamically.
const fsSpecifier: string = 'node:fs';
const urlSpecifier: string = 'node:url';
const fs = (await import(fsSpecifier)) as unknown as { readFileSync(path: string, enc: string): string };
const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

function contextFor(text: string): QuoteContext {
  const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
  const paragraphChunkIds = new Map<number, string>();
  for (const c of chunks) {
    if (c.location.sourceType === 'paste' && !paragraphChunkIds.has(c.location.paragraphNumber)) {
      paragraphChunkIds.set(c.location.paragraphNumber, c.id);
    }
  }
  return { chunks: new Map<string, Chunk>(chunks.map((c) => [c.id, c])), paragraphChunkIds };
}

const ids = (failures: readonly { checkId: string }[]): string[] => failures.map((f) => f.checkId);

// ---------------------------------------------------------------------------
// Fixture-literal tests: every combination-dial code:* fixture, expected Check_ID read at test time.
// The fixtures are fed RAW (not schema-parsed): adv-08 has a template the schema's closed enum
// and an `expression` key it rejects, so the checks must accept pre-schema input.
// ---------------------------------------------------------------------------
interface Fixture {
  readonly id: string;
  readonly notes: string;
  readonly notesDir?: string;
  readonly expectedCatch: string;
  readonly question: { readonly id: string; readonly lockType: string };
}
const allFixtures = (
  JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as { fixtures: Fixture[] }
).fixtures;
const dialCodeFixtures = allFixtures.filter(
  (f) => f.question.lockType === 'combination-dial' && f.expectedCatch.startsWith('code:'),
);

describe('combination-dial code:* fixtures (fixture-literal)', () => {
  it('finds the dial code fixtures and none expects answer-not-in-quote', () => {
    expect(dialCodeFixtures.map((f) => f.id)).toEqual(expect.arrayContaining(['adv-08', 'adv-09', 'adv-28']));
    expect(dialCodeFixtures.some((f) => f.expectedCatch === 'code:answer-not-in-quote')).toBe(false);
  });

  it.each(dialCodeFixtures.map((f) => [f.id, f] as const))('%s fails with exactly its expected Check_ID', (_id, f) => {
    const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : 'eval/dev/notes';
    const context = contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
    const raw = f.question as unknown as CombinationDialAuthoringQuestion;
    expect(ids(combinationDialChecks(raw, context))).toEqual([f.expectedCatch.slice('code:'.length)]);
  });
});

// ---------------------------------------------------------------------------
// Boundary unit tests on hand-written notes.
// ---------------------------------------------------------------------------
const NOTES =
  'The cafe sold 1,200 cups of coffee on the busiest day of the year. ' +
  'Platelets live for about 7-10 days in the blood of an adult. ' +
  'The average adult has two kidneys and about 5 litres of blood. ' +
  'The price rose from 100 dollars to 150 dollars over the year. ' +
  'A normal heart rate is between 60 and 100 beats per minute.';
const CTX = contextFor(NOTES);
const Q_CUPS = 'The cafe sold 1,200 cups of coffee on the busiest day';
const Q_DAYS = 'Platelets live for about 7-10 days in the blood';
const Q_KIDNEYS = 'The average adult has two kidneys and about 5 litres of blood';
const Q_PRICE = 'The price rose from 100 dollars to 150 dollars over the year';
const Q_HEART = 'A normal heart rate is between 60 and 100 beats per minute';

function dial(answer: unknown, quote: string, overrides: Record<string, unknown> = {}): CombinationDialAuthoringQuestion {
  return {
    id: 'q',
    conceptId: 'c',
    role: 'primary',
    lockType: 'combination-dial',
    prompt: 'According to your notes, how many are there?',
    answer,
    units: 'cups',
    evidence: [{ paragraph: 1, quote }],
    explanation: '-',
    ...overrides,
  } as unknown as CombinationDialAuthoringQuestion;
}

describe('numberAppearsVerbatim', () => {
  it.each([
    ['sold 1,200 cups', 1200, true],
    ['sold 1200 cups', 1200, true],
    ['sold 1,200 cups', 1201, false],
    ['about 97 percent', 97, true],
    ['about 970 percent', 97, false],
    ['about 97 percent', 9, false],
    ['weighs 21.5 kilograms', 21.5, true],
    ['weighs 21.5 kilograms', 21, false],
    ['for about two weeks', 2, true],
    ['for about nine days', 9, true],
    ['lives 7-10 days', 10, true],
    ['lives 7-10 days', 7, true],
    ['on July 24.', 24, true],
    ['it fell by -20 points', -20, true],
    ['it fell by 20 points', -20, false],
  ])('%j contains %d: %s', (quote, n, expected) => {
    expect(numberAppearsVerbatim(quote, n)).toBe(expected);
  });
});

describe('missing-units', () => {
  it.each([['', true], ['   ', true], ['(no units)', false], ['cups', false]])('units %j fails=%s', (units, fails) => {
    expect(ids(checkMissingUnits(dial({ kind: 'exact', value: 1200 }, Q_CUPS, { units })))).toEqual(
      fails ? ['missing-units'] : [],
    );
  });
});

describe('number-not-in-quote (exact answers)', () => {
  it('passes a number stated verbatim, with thousands separator normalised', () => {
    expect(checkNumberNotInQuote(dial({ kind: 'exact', value: 1200 }, Q_CUPS), CTX)).toEqual([]);
  });
  it('passes a written-out number word', () => {
    expect(checkNumberNotInQuote(dial({ kind: 'exact', value: 2 }, Q_KIDNEYS), CTX)).toEqual([]);
  });
  it('fails a number that is not in the quote', () => {
    expect(ids(checkNumberNotInQuote(dial({ kind: 'exact', value: 1250 }, Q_CUPS), CTX))).toEqual(['number-not-in-quote']);
  });
  it('fails when the only quote does not resolve', () => {
    const q = dial({ kind: 'exact', value: 1200 }, 'The cafe sold 1,200 cups of tea on a quiet day');
    expect(ids(checkNumberNotInQuote(q, CTX))).toEqual(['number-not-in-quote']);
  });
  it('does not check range or template answers', () => {
    expect(checkNumberNotInQuote(dial({ kind: 'range', min: 1, max: 2 }, Q_CUPS), CTX)).toEqual([]);
    expect(checkNumberNotInQuote(dial({ kind: 'template', template: 'difference', inputs: [1, 2], value: -1 }, Q_CUPS), CTX)).toEqual([]);
  });
});

describe('range-not-in-quote', () => {
  it('passes a range whose endpoints are both in one quote', () => {
    expect(checkRangeNotInQuote(dial({ kind: 'range', min: 7, max: 10 }, Q_DAYS), CTX)).toEqual([]);
    expect(checkRangeNotInQuote(dial({ kind: 'range', min: 60, max: 100 }, Q_HEART), CTX)).toEqual([]);
  });
  it('fails when one endpoint is missing', () => {
    expect(ids(checkRangeNotInQuote(dial({ kind: 'range', min: 7, max: 12 }, Q_DAYS), CTX))).toEqual(['range-not-in-quote']);
  });
  it('fails when the endpoints are in different quotes', () => {
    const q = dial({ kind: 'range', min: 7, max: 150 }, Q_DAYS, {
      evidence: [{ paragraph: 1, quote: Q_DAYS }, { paragraph: 1, quote: Q_PRICE }],
    });
    expect(ids(checkRangeNotInQuote(q, CTX))).toEqual(['range-not-in-quote']);
  });
  it('fails a reversed range, which no answer could satisfy', () => {
    expect(ids(checkRangeNotInQuote(dial({ kind: 'range', min: 100, max: 60 }, Q_HEART), CTX))).toEqual(['range-not-in-quote']);
  });
  it('is not used for exact answers', () => {
    expect(checkRangeNotInQuote(dial({ kind: 'exact', value: 1 }, Q_CUPS), CTX)).toEqual([]);
  });
});

describe('template checks', () => {
  const tpl = (template: string, inputs: number[], value: number) =>
    dial({ kind: 'template', template, inputs, value }, Q_PRICE);

  it('computeTemplate matches the two allowlisted formulas', () => {
    expect(computeTemplate('difference', [150, 100])).toBe(50);
    expect(computeTemplate('percent-change', [100, 150])).toBe(50);
    expect(computeTemplate('percent-change', [100, 80])).toBe(-20);
    expect(computeTemplate('percent-change', [0, 5])).toBeNull();
    expect(computeTemplate('difference', [1])).toBeNull();
  });

  it('template-not-allowlisted fails any other name', () => {
    expect(ids(checkTemplateNotAllowlisted(tpl('elasticity', [100, 150], 0.5)))).toEqual(['template-not-allowlisted']);
    expect(checkTemplateNotAllowlisted(tpl('difference', [150, 100], 50))).toEqual([]);
    expect(checkTemplateNotAllowlisted(tpl('percent-change', [100, 150], 50))).toEqual([]);
    expect(checkTemplateNotAllowlisted(dial({ kind: 'exact', value: 1 }, Q_CUPS))).toEqual([]);
  });

  it('template-input-not-in-quote fails when an input is not stated', () => {
    expect(checkTemplateInputNotInQuote(tpl('difference', [150, 100], 50), CTX)).toEqual([]);
    expect(ids(checkTemplateInputNotInQuote(tpl('difference', [150, 90], 60), CTX))).toEqual(['template-input-not-in-quote']);
  });

  it('template-value-mismatch recomputes in code and never trusts the model value', () => {
    expect(checkTemplateValueMismatch(tpl('difference', [150, 100], 50))).toEqual([]);
    expect(checkTemplateValueMismatch(tpl('percent-change', [100, 150], 50))).toEqual([]);
    expect(ids(checkTemplateValueMismatch(tpl('difference', [150, 100], 51)))).toEqual(['template-value-mismatch']);
    expect(ids(checkTemplateValueMismatch(tpl('percent-change', [100, 150], 33.3)))).toEqual(['template-value-mismatch']);
  });

  it('template-value-mismatch fails a percent change from zero and stays silent for unlisted templates', () => {
    expect(ids(checkTemplateValueMismatch(tpl('percent-change', [0, 150], 0)))).toEqual(['template-value-mismatch']);
    expect(checkTemplateValueMismatch(tpl('elasticity', [100, 150], 0.5))).toEqual([]);
  });
});

describe('model-written-expression', () => {
  it('flags an expression key on the answer or the question, from raw input', () => {
    const raw = { answer: { kind: 'exact', value: 1, expression: '2-1' } };
    expect(ids(checkModelWrittenExpression(raw, 'q'))).toEqual(['model-written-expression']);
    expect(ids(checkModelWrittenExpression({ expression: '1+1', answer: { kind: 'exact', value: 2 } }, 'q'))).toEqual([
      'model-written-expression',
    ]);
  });
  it('passes a plain answer and tolerates non-objects', () => {
    expect(checkModelWrittenExpression({ answer: { kind: 'exact', value: 1 } }, 'q')).toEqual([]);
    expect(checkModelWrittenExpression(null, 'q')).toEqual([]);
    expect(checkModelWrittenExpression('2+2', 'q')).toEqual([]);
  });
});

describe('dial-range-prompt', () => {
  const range = (prompt: string) => dial({ kind: 'range', min: 60, max: 100 }, Q_HEART, { prompt });
  it.each([
    'According to your notes, give both the lowest and highest normal heart rate.',
    'According to your notes, what is the range of a normal heart rate?',
    'According to your notes, give the minimum and maximum heart rate.',
    'According to your notes, name two values for a normal heart rate.',
  ])('fails a plural range prompt: %s', (prompt) => {
    expect(ids(checkDialRangePrompt(range(prompt)))).toEqual(['dial-range-prompt']);
  });
  it('passes a prompt that asks for one value', () => {
    expect(
      checkDialRangePrompt(range('According to your notes, give a normal heart rate. Any value in the normal range counts.')),
    ).toEqual([]);
  });
  it('ignores exact answers', () => {
    expect(checkDialRangePrompt(dial({ kind: 'exact', value: 4 }, Q_CUPS, { prompt: 'What is the range of both?' }))).toEqual([]);
  });
});

describe('combinationDialChecks aggregate', () => {
  it('passes a sound exact question', () => {
    expect(combinationDialChecks(dial({ kind: 'exact', value: 1200 }, Q_CUPS), CTX)).toEqual([]);
  });
  it('adds the quote check for an unresolved quote', () => {
    const q = dial({ kind: 'exact', value: 1200 }, 'The cafe sold 1,200 cups of tea on a quiet day');
    expect(ids(combinationDialChecks(q, CTX))).toContain('quote-not-found');
  });
  it('reports a root cause once: an unlisted template with an expression is only template-not-allowlisted', () => {
    const q = dial({ kind: 'template', template: 'elasticity', inputs: [100, 150], value: 0.5, expression: 'x' }, Q_PRICE);
    expect(ids(combinationDialChecks(q, CTX))).toEqual(['template-not-allowlisted']);
  });
  it('reports an expression on an exact answer', () => {
    const q = dial({ kind: 'exact', value: 1200, expression: '12*100' }, Q_CUPS);
    expect(ids(combinationDialChecks(q, CTX))).toEqual(['model-written-expression']);
  });
  it('reports missing units', () => {
    expect(ids(combinationDialChecks(dial({ kind: 'exact', value: 1200 }, Q_CUPS, { units: '' }), CTX))).toEqual(['missing-units']);
  });
});
