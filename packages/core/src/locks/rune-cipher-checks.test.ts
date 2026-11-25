import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion, RuneCipherAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import { CHECK_REGISTRY } from '../checks/registry';
import {
  runChecks,
  runRoomChecks,
  type CheckableQuestion,
  type EvidenceContext,
} from '../checks/run-checks';
import type { CheckFailure } from '../checks/types';
import type { Chunk } from '../types';
import {
  checkAnswerInQuote,
  checkAnswerLeakInPrompt,
  checkRuneNeedsOneBlank,
  runeCipherChecks,
} from './rune-cipher-checks';

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

function parseRune(raw: unknown): RuneCipherAuthoringQuestion {
  const r = parseAuthoringQuestion(raw);
  if (!r.ok || r.value.lockType !== 'rune-cipher') throw new Error('not a rune cipher question');
  return r.value;
}

function asCheckable(raw: Record<string, unknown>): CheckableQuestion {
  const r = parseAuthoringQuestion(raw);
  if (r.ok) return r.value as AuthoringQuestion;
  return raw as unknown as CheckableQuestion;
}

interface RealFile {
  file: string;
  questions: Record<string, unknown>[];
  context: EvidenceContext;
}

async function realFiles(): Promise<RealFile[]> {
  const { fs, root } = await loadRoot();
  const out: RealFile[] = [];
  for (const [qdir, ndir] of [
    ['eval/dev/questions', 'eval/dev/notes'],
    ['samples/questions', 'samples'],
  ] as const) {
    for (const f of fs.readdirSync(`${root}/${qdir}`)) {
      const json = JSON.parse(fs.readFileSync(`${root}/${qdir}/${f}`, 'utf8')) as {
        notes: string;
        questions: Record<string, unknown>[];
      };
      const notes = fs.readFileSync(`${root}/${ndir}/${json.notes}`, 'utf8');
      out.push({ file: `${qdir}/${f}`, questions: json.questions, context: contextFor(notes) });
    }
  }
  return out;
}

interface Fixture {
  id: string;
  expectedCatch: string;
  notes: string;
  notesDir?: string;
  roomContext?: Record<string, unknown>[];
  question: Record<string, unknown>;
}

async function runeFixtures(): Promise<{ fixture: Fixture; context: EvidenceContext }[]> {
  const { fs, root } = await loadRoot();
  const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as {
    fixtures: Fixture[];
  };
  return all.fixtures
    .filter((f) => f.expectedCatch.startsWith('code:') && f.question.lockType === 'rune-cipher')
    .map((fixture) => {
      const dir = fixture.notesDir === undefined ? 'eval/dev/notes' : `eval/${fixture.notesDir}`;
      const resolved = fixture.notesDir === 'samples' ? 'samples' : dir;
      return {
        fixture,
        context: contextFor(fs.readFileSync(`${root}/${resolved}/${fixture.notes}`, 'utf8')),
      };
    });
}

const base: RuneCipherAuthoringQuestion = {
  id: 'u1',
  conceptId: 'c1',
  role: 'primary',
  lockType: 'rune-cipher',
  prompt: 'According to your notes, the pump of the body is the ______.',
  answer: 'heart',
  aliases: [],
  caseSensitive: false,
  evidence: [{ paragraph: 1, quote: 'The heart pumps blood around the body.' }],
  explanation: 'x',
};

const CTX = contextFor(
  'The heart pumps blood around the body. The heart rests between beats. The heart rests between beats.',
);

describe('rune cipher checks (unit)', () => {
  it('passes a well-formed question', () => {
    expect(runeCipherChecks(base, CTX)).toEqual([]);
  });

  it('requires exactly one blank run', () => {
    for (const prompt of ['No blank here.', 'Two ___ blanks ___ here.', 'Short __ run.']) {
      expect(checkRuneNeedsOneBlank({ ...base, prompt }).map((f) => f.checkId)).toEqual([
        'rune-needs-one-blank',
      ]);
    }
    expect(checkRuneNeedsOneBlank({ ...base, prompt: 'A ___ B' })).toEqual([]);
  });

  it('checks the answer, not aliases, against the quotes', () => {
    expect(checkAnswerInQuote({ ...base, answer: 'lung' }, CTX).map((f) => f.checkId)).toEqual([
      'answer-not-in-quote',
    ]);
    expect(checkAnswerInQuote({ ...base, aliases: ['cardiac muscle'] }, CTX)).toEqual([]);
    expect(checkAnswerInQuote({ ...base, answer: 'Heart', caseSensitive: true }, CTX)).toHaveLength(1);
  });

  it('reports only quote-ambiguous when the only quote is ambiguous and lacks the answer', () => {
    const q = { ...base, evidence: [{ paragraph: 1, quote: 'The heart rests between beats.' }], answer: 'lung' };
    expect(blocking(runChecks({ question: q, ...CTX }))).toEqual(['quote-ambiguous']);
    expect(checkAnswerInQuote(q, CTX)).toEqual([]);
  });

  it('still reports answer-not-in-quote when a resolved quote lacks the answer', () => {
    const q = { ...base, answer: 'lung' };
    expect(blocking(runChecks({ question: q, ...CTX }))).toEqual(['answer-not-in-quote']);
  });

  it('detects a leak only on word boundaries', () => {
    const leak = { ...base, prompt: 'The heart is the ______.' };
    expect(checkAnswerLeakInPrompt(leak).map((f) => f.checkId)).toEqual(['answer-leak-in-prompt']);
    expect(checkAnswerLeakInPrompt({ ...base, prompt: 'A heartbeat is from the ______.' })).toEqual([]);
  });
});

describe('rune cipher checks against real questions', () => {
  it('every rune cipher question in dev and sample sets passes all blocking checks', async () => {
    let seen = 0;
    for (const { file, questions, context } of await realFiles()) {
      const checkable = questions.map(asCheckable);
      for (const raw of questions) {
        if (raw.lockType !== 'rune-cipher') continue;
        seen += 1;
        const q = parseRune(raw);
        const siblings = checkable.filter((s) => s.id !== q.id);
        const failures = runChecks({ question: q, siblings, ...context });
        expect(blocking(failures), `${file} ${q.id}`).toEqual([]);
        expect(runeCipherChecks(q, context), `${file} ${q.id}`).toEqual([]);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('rune cipher checks against adversarial fixtures', () => {
  it('each code:* rune fixture yields exactly its expected blocking Check_ID', async () => {
    const fixtures = await runeFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    for (const { fixture, context } of fixtures) {
      const expected = fixture.expectedCatch.slice('code:'.length);
      const q = parseRune(fixture.question);
      const siblings = (fixture.roomContext ?? []).map(asCheckable);
      const failures = runChecks({ question: q, siblings, ...context });
      if (expected === 'answer-leak-in-room') {
        // Room-level check: runChecks alone must raise nothing blocking.
        expect(blocking(failures), fixture.id).toEqual([]);
        const room = runRoomChecks([...siblings, q], context);
        expect(blocking(room), fixture.id).toEqual([expected]);
      } else {
        expect(blocking(failures), fixture.id).toEqual([expected]);
      }
    }
  });
});
