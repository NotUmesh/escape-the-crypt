import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { BoundThreadsAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import type { Chunk } from '../types';
import { boundThreadsChecks, checkNotOneToOne, checkPairCount } from './bound-threads-checks';

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

interface Case {
  readonly label: string;
  readonly question: BoundThreadsAuthoringQuestion;
  readonly context: QuoteContext;
}

/** Real bound-threads questions of eval/dev and samples (nothing else is read). */
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
        if (r['lockType'] !== 'bound-threads') continue;
        const parsed = parseAuthoringQuestion(r);
        if (parsed.ok && parsed.value.lockType === 'bound-threads') {
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

function adversarialFixtures(): Fixture[] {
  const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as {
    fixtures: Fixture[];
  };
  return all.fixtures.filter(
    (f) => f.question['lockType'] === 'bound-threads' && f.expectedCatch.startsWith('code:'),
  );
}

function fixtureContext(f: Fixture): QuoteContext {
  const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
  return contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
}

const ids = (failures: readonly { checkId: string }[]): string[] => failures.map((f) => f.checkId);
const pairs = (...lr: [string, string][]) => ({ id: 'q', pairs: lr.map(([left, right]) => ({ left, right })) });

describe('bound-threads pair-count and not-one-to-one', () => {
  it.each([[2, true], [3, false], [4, false], [5, true]])('%i pairs fails=%s', (n, fails) => {
    const q = { id: 'q', pairs: Array.from({ length: n }, (_, i) => ({ left: `l${i}`, right: `r${i}` })) };
    expect(ids(checkPairCount(q))).toEqual(fails ? ['pair-count'] : []);
  });

  it('flags a repeated left or right after case and whitespace normalisation', () => {
    expect(ids(checkNotOneToOne(pairs(['Ridge', 'A'], ['ridge ', 'B'], ['Rift', 'C'])))).toEqual(['not-one-to-one']);
    expect(ids(checkNotOneToOne(pairs(['X', 'Same  thing'], ['Y', 'same thing'], ['Z', 'C'])))).toEqual(['not-one-to-one']);
    expect(checkNotOneToOne(pairs(['X', 'A'], ['Y', 'B'], ['Z', 'C']))).toEqual([]);
  });
});

describe('bound-threads checks against real fixtures', () => {
  const real = realCases();

  it('reads real bound-threads questions from dev and samples', () => {
    expect(real.length).toBeGreaterThan(0);
  });

  it.each(real.map((c) => [c.label, c] as const))('%s: no failures', (_label, c) => {
    expect(ids(boundThreadsChecks(c.question, c.context))).toEqual([]);
  });

  const adversarial = adversarialFixtures();

  it('reads the code:* adversarial bound-threads fixtures', () => {
    expect(adversarial.length).toBeGreaterThan(0);
  });

  it.each(adversarial.map((f) => [f.id, f] as const))('%s: exactly its expected Check_ID', (_id, f) => {
    const got = ids(boundThreadsChecks(f.question as unknown as BoundThreadsAuthoringQuestion, fixtureContext(f)));
    expect(got).toEqual([f.expectedCatch.slice(5)]);
  });
});
