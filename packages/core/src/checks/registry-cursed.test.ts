import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { CursedObjectAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { Chunk } from '../types';
import { CHECK_REGISTRY } from './registry';
import { runChecks, visibleTextOf, type EvidenceContext } from './run-checks';

// Deliberate flip (task 33.3): the four cursed-object ids are now implemented: true and
// runChecks calls cursedObjectChecks. (Task 35.2 then flipped combination-dial; see registry-dial.test.ts.)

// packages/core compiles without Node types, so load Node modules dynamically.
const fsSpecifier: string = 'node:fs';
const urlSpecifier: string = 'node:url';
const fs = (await import(fsSpecifier)) as unknown as {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
};
const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

function contextFor(text: string): EvidenceContext {
  const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
  const paragraphChunkIds = new Map<number, string>();
  for (const c of chunks) {
    if (c.location.sourceType === 'paste' && !paragraphChunkIds.has(c.location.paragraphNumber)) {
      paragraphChunkIds.set(c.location.paragraphNumber, c.id);
    }
  }
  return { chunks: new Map<string, Chunk>(chunks.map((c) => [c.id, c])), paragraphChunkIds };
}

const CURSED_IDS = [
  'item-count',
  'answer-not-an-item',
  'missing-category-rule',
  'needs-category-and-outside-quotes',
];

describe('cursed-object registry entries', () => {
  it('are all implemented, blocking and scoped to cursed-object', () => {
    const entries = CHECK_REGISTRY.filter((r) => CURSED_IDS.includes(r.id));
    expect(entries.map((r) => r.id)).toEqual(CURSED_IDS);
    for (const r of entries) {
      expect(r).toMatchObject({ scope: ['cursed-object'], severity: 'blocking', implemented: true });
    }
  });
});

interface Case {
  readonly label: string;
  readonly raw: Record<string, unknown>;
  readonly context: EvidenceContext;
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
      for (const raw of json.questions) {
        if (raw['lockType'] === 'cursed-object') cases.push({ label: `${f}:${String(raw['id'])}`, raw, context });
      }
    }
  }
  return cases;
}

describe('runChecks on cursed-object questions', () => {
  const real = realCases();

  it('finds real cursed-object questions in eval/dev and samples', () => {
    expect(real.length).toBeGreaterThan(0);
  });

  it.each(real.map((c) => [c.label, c] as const))('%s: runChecks returns no failures', (_label, c) => {
    const parsed = parseAuthoringQuestion(c.raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(runChecks({ question: parsed.value, ...c.context })).toEqual([]);
  });

  const fixtures = (
    JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as {
      fixtures: { id: string; notes: string; notesDir?: string; question: Record<string, unknown> }[];
    }
  ).fixtures;

  function runFixture(id: string) {
    const f = fixtures.find((x) => x.id === id);
    expect(f).toBeDefined();
    const dir =
      f!.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f!.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
    const context = contextFor(fs.readFileSync(`${root}/${dir}/${f!.notes}`, 'utf8'));
    // Not parsed: adv-27 has five items, which the schema (exactly four) rejects before the
    // item-count Code_Check can run. The fixture is cast, as in cursed-object-checks.test.ts.
    return runChecks({ question: f!.question as unknown as CursedObjectAuthoringQuestion, ...context });
  }

  it('adv-20 (a review fixture) passes every code check', () => {
    expect(runFixture('adv-20')).toEqual([]);
  });

  it('adv-27 fails exactly item-count', () => {
    expect(runFixture('adv-27').map((f) => f.checkId)).toEqual(['item-count']);
  });

  it('applies the "which one is not" exemption to a real cursed-object prompt', () => {
    const c = real.find((x) => /which (?:one|of these) .* not\b/i.test(String(x.raw['prompt'])));
    expect(c, 'no real prompt uses the odd-one-out wording').toBeDefined();
    const parsed = parseAuthoringQuestion(c!.raw);
    if (!parsed.ok) throw new Error('does not parse');
    expect(runChecks({ question: parsed.value, ...c!.context }).map((f) => f.checkId)).not.toContain('negative-question');
  });

  it('visibleTextOf returns the prompt, the four items and the explanation', () => {
    const parsed = parseAuthoringQuestion(real[0]!.raw);
    if (!parsed.ok || parsed.value.lockType !== 'cursed-object') throw new Error('does not parse');
    const q = parsed.value;
    expect(visibleTextOf(q)).toEqual([q.prompt, ...q.items, q.explanation]);
    expect(q.items).toHaveLength(4);
  });
});
