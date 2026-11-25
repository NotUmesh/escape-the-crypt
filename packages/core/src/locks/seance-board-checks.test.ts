import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { SeanceBoardAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import { CHECK_REGISTRY } from '../checks/registry';
import { runChecks, type EvidenceContext } from '../checks/run-checks';
import type { CheckFailure } from '../checks/types';
import type { Chunk } from '../types';
import { checkSeanceBoard } from './seance-board-checks';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
}
async function loadRoot(): Promise<{ fs: FsLike; root: string }> {
  const fsSpecifier: string = 'node:fs';
  const urlSpecifier: string = 'node:url';
  const fs = (await import(fsSpecifier)) as unknown as FsLike;
  const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
  const href = (import.meta as unknown as { url: string }).url;
  const here = url.fileURLToPath(href).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  return { fs, root: `${here}/../../../..` };
}

function contextFor(notes: string): EvidenceContext {
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

const blockingIds = new Set(
  CHECK_REGISTRY.filter((r) => r.severity === 'blocking').map((r) => r.id as string),
);
const blocking = (failures: readonly CheckFailure[]): string[] =>
  failures.map((f) => f.checkId as string).filter((id) => blockingIds.has(id));

function parseSeance(raw: unknown): SeanceBoardAuthoringQuestion {
  const r = parseAuthoringQuestion(raw);
  if (!r.ok || r.value.lockType !== 'seance-board') throw new Error('not a seance board question');
  return r.value;
}

interface Fixture {
  id: string;
  expectedCatch: string;
  notes: string;
  notesDir?: string;
  question: Record<string, unknown>;
}

async function seanceFixtures(): Promise<{ fixture: Fixture; context: EvidenceContext }[]> {
  const { fs, root } = await loadRoot();
  const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as {
    fixtures: Fixture[];
  };
  return all.fixtures
    .filter((f) => f.question.lockType === 'seance-board')
    .map((fixture) => {
      const dir = fixture.notesDir === undefined ? 'eval/dev/notes' : `eval/${fixture.notesDir}`;
      return {
        fixture,
        context: contextFor(fs.readFileSync(`${root}/${dir}/${fixture.notes}`, 'utf8')),
      };
    });
}

const notes = 'Hearts pump blood.\n\nThe heart pumps blood around the whole body every minute.';
const unitContext = contextFor(notes);
const QUOTE = 'The heart pumps blood around the whole body';

const option = (id: string, text: string, label: unknown, evidence: unknown = { paragraph: 2, quote: QUOTE }) => ({
  id,
  text,
  label,
  evidence,
});
const goodQuestion = {
  id: 'u1',
  conceptId: 'c1',
  role: 'primary',
  lockType: 'seance-board',
  prompt: 'According to your notes, what does the heart pump?',
  options: [option('a', 'Blood', 'supported'), option('b', 'Air', 'contradicted'), option('c', 'Lymph', 'contradicted')],
  answer: 'a',
  explanation: 'x',
};
const ids = (input: unknown): string[] =>
  checkSeanceBoard(input, unitContext).map((f) => f.checkId as string);

describe('seance board checks (unit)', () => {
  it('passes a well-formed question', () => {
    expect(ids(goodQuestion)).toEqual([]);
  });

  it('requires the "According to your notes" prompt', () => {
    expect(ids({ ...goodQuestion, prompt: 'What does the heart pump?' })).toEqual([
      'missing-according-to-your-notes',
    ]);
  });

  it('requires three or four options', () => {
    const two = goodQuestion.options.slice(0, 2);
    expect(ids({ ...goodQuestion, options: two })).toEqual(['option-count']);
  });

  it('flags duplicate options after normalisation and case folding', () => {
    const options = [
      option('a', 'Blood', 'supported'),
      option('b', ' blood ', 'contradicted'),
      option('c', 'Lymph', 'contradicted'),
    ];
    expect(ids({ ...goodQuestion, options })).toEqual(['duplicate-options']);
  });

  it('flags a raw label outside supported/contradicted', () => {
    const options = [
      option('a', 'Blood', 'supported'),
      option('b', 'Air', 'not-mentioned'),
      option('c', 'Lymph', 'contradicted'),
    ];
    expect(ids({ ...goodQuestion, options })).toEqual(['option-not-supported-or-contradicted']);
  });

  it('flags raw options with missing or blank evidence', () => {
    for (const evidence of [null, { paragraph: 2, quote: '   ' }, 'nope']) {
      const options = [
        option('a', 'Blood', 'supported'),
        option('b', 'Air', 'contradicted', evidence),
        option('c', 'Lymph', 'contradicted'),
      ];
      expect(ids({ ...goodQuestion, options })).toEqual(['option-without-evidence']);
    }
  });

  it('flags zero or several supported options', () => {
    const none = goodQuestion.options.map((o) => ({ ...o, label: 'contradicted' }));
    const two = goodQuestion.options.map((o) => ({ ...o, label: o.id === 'c' ? 'contradicted' : 'supported' }));
    expect(ids({ ...goodQuestion, options: none })).toEqual(['not-exactly-one-supported']);
    expect(ids({ ...goodQuestion, options: two })).toEqual(['not-exactly-one-supported']);
  });

  it('flags a key that is not the supported option', () => {
    expect(ids({ ...goodQuestion, answer: 'b' })).toEqual(['key-not-the-supported-option']);
  });

  it('runs the quote check on each option own evidence', () => {
    const options = [
      option('a', 'Blood', 'supported'),
      option('b', 'Air', 'contradicted', { paragraph: 2, quote: 'The heart pumps air through the body' }),
      option('c', 'Lymph', 'contradicted', { paragraph: 9, quote: QUOTE }),
    ];
    expect(ids({ ...goodQuestion, options }).sort()).toEqual(['quote-not-found', 'unknown-paragraph/chunk']);
  });

  it('never throws on non-object input', () => {
    for (const input of [null, undefined, 3, 'x', [], {}]) {
      expect(() => checkSeanceBoard(input, unitContext)).not.toThrow();
    }
  });
});

describe('seance board checks against real questions', () => {
  it('every séance board question in dev and sample sets passes all blocking checks', async () => {
    const { fs, root } = await loadRoot();
    let seen = 0;
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
          if (raw.lockType !== 'seance-board') continue;
          seen += 1;
          const q = parseSeance(raw);
          const label = `${qdir}/${f} ${q.id}`;
          expect(checkSeanceBoard(q, context), label).toEqual([]);
          expect(blocking(runChecks({ question: q, ...context })), label).toEqual([]);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('seance board checks against adversarial fixtures', () => {
  it('includes the named fixtures', async () => {
    const found = (await seanceFixtures()).map((s) => s.fixture.id);
    expect(found).toEqual(expect.arrayContaining(['adv-06', 'adv-10', 'adv-25']));
  });

  it('each code:* séance fixture yields exactly its expected blocking Check_ID', async () => {
    let seen = 0;
    for (const { fixture, context } of await seanceFixtures()) {
      if (!fixture.expectedCatch.startsWith('code:')) continue;
      seen += 1;
      const expected = fixture.expectedCatch.slice('code:'.length);
      if (fixture.id === 'adv-10') {
        // Raw pre-schema input: the label "not-mentioned" cannot pass the Zod schema.
        expect(parseAuthoringQuestion(fixture.question).ok, fixture.id).toBe(false);
        expect(blocking(checkSeanceBoard(fixture.question, context)), fixture.id).toEqual([expected]);
      } else {
        const failures = runChecks({ question: parseSeance(fixture.question), ...context });
        expect(blocking(failures), fixture.id).toEqual([expected]);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('review:* séance fixtures pass every code check on purpose', async () => {
    for (const { fixture, context } of await seanceFixtures()) {
      if (!fixture.expectedCatch.startsWith('review:')) continue;
      const failures = runChecks({ question: parseSeance(fixture.question), ...context });
      expect(blocking(failures), fixture.id).toEqual([]);
    }
  });
});
