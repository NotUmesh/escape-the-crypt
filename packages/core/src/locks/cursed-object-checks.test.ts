import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { CursedObjectAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import type { Chunk } from '../types';
import {
  checkAnswerNotAnItem,
  checkItemCount,
  checkMissingCategoryRule,
  checkNeedsCategoryAndOutsideQuotes,
  cursedObjectChecks,
} from './cursed-object-checks';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
}
const fsSpecifier: string = 'node:fs';
const urlSpecifier: string = 'node:url';
const fs = (await import(fsSpecifier)) as unknown as FsLike;
const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

function contextFor(notes: string): QuoteContext {
  const chunks = chunkDocument({ sourceType: 'paste', text: notes, originalText: notes });
  const map = new Map<string, Chunk>();
  const paragraphChunkIds = new Map<number, string>();
  for (const c of chunks) {
    map.set(c.id, c);
    if (c.location.sourceType === 'paste' && !paragraphChunkIds.has(c.location.paragraphNumber)) {
      paragraphChunkIds.set(c.location.paragraphNumber, c.id);
    }
  }
  return { chunks: map, paragraphChunkIds };
}

const ids = (failures: readonly { checkId: string }[]): string[] => failures.map((f) => f.checkId);

// ---------------------------------------------------------------------------
// Hand-written questions (own notes, own quotes) for needs-category-and-outside-quotes.
// adv-20 is NOT used as a failing case: it is a review fixture (see below).
// ---------------------------------------------------------------------------
const HAND_NOTES =
  'The notes cover three primary colours: red, yellow and blue. Green is not a primary colour because it is made by mixing. Orange is made by mixing too.';
const HAND_CONTEXT = contextFor(HAND_NOTES);
const CATEGORY_QUOTE = 'The notes cover three primary colours: red, yellow and blue.';
const OUTSIDE_QUOTE = 'Green is not a primary colour because it is made by mixing.';
const NEUTRAL_QUOTE = 'Orange is made by mixing too.';

function handQuestion(quotes: readonly string[]): CursedObjectAuthoringQuestion {
  return {
    id: 'hand-q',
    conceptId: 'hand-c',
    role: 'primary',
    lockType: 'cursed-object',
    prompt: 'According to your notes, three of these are primary colours. Which one is not?',
    items: ['Red', 'Yellow', 'Blue', 'Green'],
    answer: 'Green',
    categoryRule: 'The three primary colours are red, yellow and blue.',
    evidence: quotes.map((quote) => ({ paragraph: 1, quote })),
    explanation: '-',
  };
}

describe('needs-category-and-outside-quotes (hand-written questions)', () => {
  it('fails when no quote establishes the category', () => {
    const q = handQuestion([OUTSIDE_QUOTE, NEUTRAL_QUOTE]);
    expect(ids(checkNeedsCategoryAndOutsideQuotes(q, HAND_CONTEXT))).toEqual([
      'needs-category-and-outside-quotes',
    ]);
  });

  it('fails when the odd item is not explicitly placed outside the category', () => {
    const q = handQuestion([CATEGORY_QUOTE, NEUTRAL_QUOTE]);
    expect(ids(checkNeedsCategoryAndOutsideQuotes(q, HAND_CONTEXT))).toEqual([
      'needs-category-and-outside-quotes',
    ]);
  });

  it('fails when only one quote is given (category and outside cannot share a quote)', () => {
    const q = handQuestion([CATEGORY_QUOTE]);
    expect(ids(checkNeedsCategoryAndOutsideQuotes(q, HAND_CONTEXT))).toEqual([
      'needs-category-and-outside-quotes',
    ]);
  });

  it('passes a clear category quote plus an explicit exclusion quote', () => {
    const q = handQuestion([CATEGORY_QUOTE, OUTSIDE_QUOTE]);
    expect(ids(checkNeedsCategoryAndOutsideQuotes(q, HAND_CONTEXT))).toEqual([]);
    expect(ids(cursedObjectChecks(q, HAND_CONTEXT))).toEqual([]);
  });

  it('does not count a quote that fails to resolve', () => {
    const q = handQuestion([CATEGORY_QUOTE, 'Green is not a primary colour at all, ever.']);
    expect(ids(checkNeedsCategoryAndOutsideQuotes(q, HAND_CONTEXT))).toEqual([
      'needs-category-and-outside-quotes',
    ]);
  });
});

describe('item-count, answer-not-an-item and missing-category-rule', () => {
  const base = handQuestion([CATEGORY_QUOTE, OUTSIDE_QUOTE]);

  it.each([[3, true], [4, false], [5, true]])('%i items fails=%s', (n, fails) => {
    const q = { ...base, items: Array.from({ length: n }, (_, i) => `item ${i}`) };
    expect(ids(checkItemCount(q))).toEqual(fails ? ['item-count'] : []);
  });

  it('flags an answer that is not one of the items verbatim', () => {
    expect(ids(checkAnswerNotAnItem({ ...base, answer: 'Purple' }))).toEqual(['answer-not-an-item']);
    expect(checkAnswerNotAnItem(base)).toEqual([]);
  });

  it('flags an empty or placeholder category rule', () => {
    expect(ids(checkMissingCategoryRule({ ...base, categoryRule: '  tbd ' }))).toEqual(['missing-category-rule']);
    expect(checkMissingCategoryRule(base)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real corpus and adversarial fixtures (read at test time, never edited).
// ---------------------------------------------------------------------------
interface Case {
  readonly label: string;
  readonly question: CursedObjectAuthoringQuestion;
  readonly context: QuoteContext;
}

function realCases(): Case[] {
  const cases: Case[] = [];
  for (const [qdir, ndir] of [
    ['eval/dev/questions', 'eval/dev/notes'],
    ['samples/questions', 'samples'],
  ] as const) {
    for (const f of fs.readdirSync(`${root}/${qdir}`)) {
      const json = JSON.parse(fs.readFileSync(`${root}/${qdir}/${f}`, 'utf8')) as {
        notes: string;
        questions: Record<string, unknown>[];
      };
      const context = contextFor(fs.readFileSync(`${root}/${ndir}/${json.notes}`, 'utf8'));
      for (const r of json.questions) {
        if (r['lockType'] !== 'cursed-object') continue;
        const parsed = parseAuthoringQuestion(r);
        if (parsed.ok && parsed.value.lockType === 'cursed-object') {
          cases.push({ label: `${f}:${parsed.value.id}`, question: parsed.value, context });
        }
      }
    }
  }
  return cases;
}

interface Fixture {
  id: string;
  expectedCatch: string;
  notes: string;
  notesDir?: string;
  question: Record<string, unknown>;
}

function cursedFixtures(): Fixture[] {
  const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as {
    fixtures: Fixture[];
  };
  return all.fixtures.filter((f) => f.question['lockType'] === 'cursed-object');
}

function fixtureContext(f: Fixture): QuoteContext {
  const dir =
    f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
  return contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
}

describe('cursed-object checks against real fixtures', () => {
  const real = realCases();

  it('reads real cursed-object questions from dev and samples', () => {
    expect(real.length).toBeGreaterThan(0);
  });

  it.each(real.map((c) => [c.label, c] as const))('%s: no failures', (_label, c) => {
    expect(ids(cursedObjectChecks(c.question, c.context))).toEqual([]);
  });

  const fixtures = cursedFixtures();

  it('adv-20 passes ALL cursed-object code checks', () => {
    // adv-20's expectedCatch is `review:odd-item-not-explicitly-outside`: Moths is never
    // mentioned in the notes, and that is for the blind reviewer to reject (labels the item
    // `unknown`). The design deliberately lets it through the code stage; the review
    // rejection is tested in task 33.5. So the code checks must return [] here.
    const adv20 = fixtures.find((f) => f.id === 'adv-20');
    expect(adv20?.expectedCatch).toBe('review:odd-item-not-explicitly-outside');
    if (!adv20) return;
    const q = adv20.question as unknown as CursedObjectAuthoringQuestion;
    expect(ids(cursedObjectChecks(q, fixtureContext(adv20)))).toEqual([]);
  });

  const codeFixtures = fixtures.filter((f) => f.expectedCatch.startsWith('code:'));

  it('reads the code:* cursed-object fixtures', () => {
    expect(codeFixtures.length).toBeGreaterThan(0);
  });

  it.each(codeFixtures.map((f) => [f.id, f] as const))('%s: exactly its expected Check_ID', (_id, f) => {
    const got = ids(cursedObjectChecks(f.question as unknown as CursedObjectAuthoringQuestion, fixtureContext(f)));
    expect(got).toEqual([f.expectedCatch.slice(5)]);
  });
});
