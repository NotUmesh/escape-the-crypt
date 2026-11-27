import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { Chunk } from '../types';
import { CHECK_REGISTRY, CHECK_VERSION } from './registry';
import { runChecks, visibleTextOf, type EvidenceContext } from './run-checks';

// Deliberate flip (task 35.2): the eight combination-dial ids are now implemented: true and
// runChecks calls combinationDialChecks. This was the last lock type, so no registry entry is left
// unimplemented and runChecks never returns lock-type-not-supported for a real lock type.

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

const DIAL_IDS = [
  'missing-units',
  'number-not-in-quote',
  'range-not-in-quote',
  'template-not-allowlisted',
  'template-input-not-in-quote',
  'template-value-mismatch',
  'model-written-expression',
  'dial-range-prompt',
];

describe('combination-dial registry entries', () => {
  it('are all implemented, blocking and scoped to combination-dial', () => {
    const entries = CHECK_REGISTRY.filter((r) => DIAL_IDS.includes(r.id));
    expect(entries.map((r) => r.id)).toEqual(DIAL_IDS);
    for (const r of entries) {
      expect(r).toMatchObject({ scope: ['combination-dial'], severity: 'blocking', implemented: true });
    }
  });

  it('leave no registry entry unimplemented, and keep lock-type-not-supported registered', () => {
    expect(CHECK_REGISTRY.filter((r) => !r.implemented).map((r) => r.id)).toEqual([]);
    expect(CHECK_REGISTRY.some((r) => r.id === 'lock-type-not-supported')).toBe(true);
  });

  it('does not give the dial the rune cipher answer-not-in-quote id', () => {
    const entry = CHECK_REGISTRY.find((r) => r.id === 'answer-not-in-quote');
    expect(entry?.scope).toEqual(['rune-cipher']);
  });

  it('has a CHECK_VERSION in date style that differs from the previous one', () => {
    expect(CHECK_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(CHECK_VERSION).not.toBe('2026-11-27.4');
  });
});

interface Real {
  readonly label: string;
  readonly raw: Record<string, unknown>;
  readonly context: EvidenceContext;
}

function realQuestions(): Real[] {
  const out: Real[] = [];
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
      for (const raw of json.questions) out.push({ label: `${f}:${String(raw['id'])}`, raw, context });
    }
  }
  return out;
}

const real = realQuestions();
const realDials = real.filter((r) => r.raw['lockType'] === 'combination-dial');

describe('runChecks on combination-dial questions', () => {
  it('finds the 26 real dial questions in eval/dev and samples', () => {
    expect(realDials).toHaveLength(26);
  });

  it.each(realDials.map((r) => [r.label, r] as const))('%s: runChecks returns no failures', (_label, r) => {
    const parsed = parseAuthoringQuestion(r.raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(runChecks({ question: parsed.value, ...r.context })).toEqual([]);
  });

  it('visibleTextOf returns the prompt, the units and the explanation', () => {
    const parsed = parseAuthoringQuestion(realDials[0]!.raw);
    if (!parsed.ok || parsed.value.lockType !== 'combination-dial') throw new Error('does not parse');
    const q = parsed.value;
    expect(visibleTextOf(q)).toEqual([q.prompt, q.units, q.explanation]);
  });
});

describe('runChecks never returns lock-type-not-supported for the six lock types', () => {
  const types = ['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'];
  it.each(types)('%s', (lockType) => {
    const r = real.find((x) => x.raw['lockType'] === lockType);
    expect(r, `no real ${lockType} question`).toBeDefined();
    const parsed = parseAuthoringQuestion(r!.raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const question: AuthoringQuestion = parsed.value;
    expect(runChecks({ question, ...r!.context }).map((f) => f.checkId)).not.toContain('lock-type-not-supported');
  });

  it('returns it only for a lockType outside the six (synthetic cast)', () => {
    const question = { id: 'q', conceptId: 'c', role: 'primary', lockType: 'unknown-lock-type' } as unknown as AuthoringQuestion;
    expect(runChecks({ question, chunks: new Map(), paragraphChunkIds: new Map() })).toEqual([
      { checkId: 'lock-type-not-supported', questionId: 'q' },
    ]);
  });
});
