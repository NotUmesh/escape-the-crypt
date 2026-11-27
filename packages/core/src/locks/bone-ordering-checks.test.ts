import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { BoneOrderingAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import type { Chunk } from '../types';
import {
  boneOrderingChecks,
  checkDuplicateSteps,
  checkSequenceMarker,
  checkStepCount,
} from './bone-ordering-checks';

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
  readonly question: BoneOrderingAuthoringQuestion;
  readonly context: QuoteContext;
}

function boneQuestions(raw: readonly Record<string, unknown>[]): BoneOrderingAuthoringQuestion[] {
  const out: BoneOrderingAuthoringQuestion[] = [];
  for (const r of raw) {
    if (r['lockType'] !== 'bone-ordering') continue;
    const parsed = parseAuthoringQuestion(r);
    if (parsed.ok && parsed.value.lockType === 'bone-ordering') out.push(parsed.value);
  }
  return out;
}

/** Real bone-ordering questions of eval/dev and samples (nothing else is read). */
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
      for (const question of boneQuestions(json.questions)) {
        cases.push({ label: `${f}:${question.id}`, question, context });
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
  return all.fixtures.filter((f) => f.question['lockType'] === 'bone-ordering');
}

function fixtureContext(f: Fixture): QuoteContext {
  const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
  return contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
}

const ids = (failures: readonly { checkId: string }[]): string[] => failures.map((f) => f.checkId);

describe('bone-ordering step-count and duplicate-steps', () => {
  const q = (steps: string[]) => ({ id: 'q', steps });

  it.each([[2, true], [3, false], [5, false], [6, true]])('%i steps fails=%s', (n, fails) => {
    const steps = Array.from({ length: n }, (_, i) => `step ${i}`);
    expect(ids(checkStepCount(q(steps)))).toEqual(fails ? ['step-count'] : []);
  });

  it('flags steps equal after case and whitespace normalisation', () => {
    expect(ids(checkDuplicateSteps(q(['Heat it', 'heat   it', 'Cool it'])))).toEqual(['duplicate-steps']);
    expect(checkDuplicateSteps(q(['Heat it', 'Cool it', 'Store it']))).toEqual([]);
  });
});

describe('no-explicit-sequence-marker-in-quotes against real fixtures', () => {
  const real = realCases();

  it('reads real bone-ordering questions from dev and samples', () => {
    expect(real.length).toBeGreaterThanOrEqual(10);
  });

  it.each(real.map((c) => [c.label, c] as const))('%s: no sequence-marker failure', (_label, c) => {
    expect(ids(checkSequenceMarker(c.question, c.context))).toEqual([]);
    expect(ids(boneOrderingChecks(c.question, c.context))).toEqual([]);
  });

  const adversarial = adversarialFixtures();

  it('reads the adversarial bone-ordering fixtures', () => {
    expect(adversarial.length).toBeGreaterThan(0);
  });

  it.each(adversarial.map((f) => [f.id, f] as const))('%s: only its own code check fires', (_id, f) => {
    // Raw cast: adv-26 has 6 steps, which the schema rejects before step-count could run.
    const got = ids(boneOrderingChecks(f.question as unknown as BoneOrderingAuthoringQuestion, fixtureContext(f)));
    const expected = f.expectedCatch.startsWith('code:') ? [f.expectedCatch.slice(5)] : [];
    expect(got).toEqual(expected);
  });

  it('skips unresolved quotes: nothing to read, so no marker failure', () => {
    const c = real[0]!;
    const broken = { ...c.question, evidence: [{ paragraph: 1, quote: 'text that is not in the notes at all' }] };
    expect(checkSequenceMarker(broken, c.context)).toEqual([]);
    expect(ids(boneOrderingChecks(broken, c.context))).toEqual(['quote-not-found']);
  });
});
