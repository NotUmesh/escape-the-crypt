import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from './authoring/parse';
import type { AuthoringQuestion } from './authoring/schema';
import { chunkDocument } from './chunker';
import { CHECK_REGISTRY } from './checks/registry';
import {
  runChecks,
  runRoomChecks,
  type CheckableQuestion,
  type EvidenceContext,
} from './checks/run-checks';

// Phase 5 dataset acceptance: the four lock types added after rune cipher and séance board.
// Counts are the files as they stand; if a file changes on purpose, update the constant.
type Phase5Type = 'bone-ordering' | 'bound-threads' | 'cursed-object' | 'combination-dial';
const PHASE5_TYPES: readonly Phase5Type[] = ['bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'];

const EXPECTED_DEV_QUESTIONS: Readonly<Record<Phase5Type, number>> = {
  'bone-ordering': 8,
  'bound-threads': 14,
  'cursed-object': 10,
  'combination-dial': 19,
};
const EXPECTED_SAMPLE_QUESTIONS: Readonly<Record<Phase5Type, number>> = {
  'bone-ordering': 3,
  'bound-threads': 5,
  'cursed-object': 3,
  'combination-dial': 7,
};
const EXPECTED_CODE_FIXTURES: Readonly<Record<Phase5Type, number>> = {
  'bone-ordering': 2,
  'bound-threads': 1,
  'cursed-object': 1,
  'combination-dial': 3,
};
const EXPECTED_REVIEW_FIXTURES: Readonly<Record<Phase5Type, number>> = {
  'bone-ordering': 2,
  'bound-threads': 1,
  'cursed-object': 1,
  'combination-dial': 2,
};

interface Fixture {
  readonly id: string;
  readonly notes: string;
  readonly notesDir?: string;
  readonly expectedCatch: string;
  readonly roomContext?: readonly unknown[];
  readonly question: { readonly id: string; readonly lockType: string };
}

interface QuestionsFile {
  readonly notes: string;
  readonly questions: readonly unknown[];
}

interface LoadedFile {
  readonly name: string;
  readonly notesPath: string;
  readonly data: QuestionsFile;
}

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
};
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const metaUrl = (import.meta as unknown as { url: string }).url;
const here = url.fileURLToPath(metaUrl).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
const root = `${here}/../../..`;

function readText(relative: string): string {
  return fs.readFileSync(`${root}/${relative}`, 'utf8');
}

function loadQuestionFiles(dir: string, notesDir: string): LoadedFile[] {
  return fs
    .readdirSync(`${root}/${dir}`)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((name) => {
      const data = JSON.parse(readText(`${dir}/${name}`)) as QuestionsFile;
      return { name: `${dir}/${name}`, notesPath: `${notesDir}/${data.notes}`, data };
    });
}

function contextFromNotes(text: string): EvidenceContext {
  const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
  const paragraphChunkIds = new Map<number, string>();
  for (const chunk of chunks) {
    if (chunk.location.sourceType !== 'paste') continue;
    if (!paragraphChunkIds.has(chunk.location.paragraphNumber)) {
      paragraphChunkIds.set(chunk.location.paragraphNumber, chunk.id);
    }
  }
  return { chunks: new Map(chunks.map((c) => [c.id, c])), paragraphChunkIds };
}

const blockingIds = new Set<string>(
  CHECK_REGISTRY.filter((r) => r.severity === 'blocking').map((r) => r.id),
);

function isPhase5Type(lockType: unknown): lockType is Phase5Type {
  return (PHASE5_TYPES as readonly unknown[]).includes(lockType);
}

const devFiles = loadQuestionFiles('eval/dev/questions', 'eval/dev/notes');
const sampleFiles = loadQuestionFiles('samples/questions', 'samples');
const fixtures = (JSON.parse(readText('eval/adversarial/fixtures.json')) as { fixtures: Fixture[] })
  .fixtures;

const phase5Of = (files: readonly LoadedFile[]): readonly unknown[] =>
  files.flatMap((f) => f.data.questions.filter((q) => isPhase5Type((q as { lockType?: unknown }).lockType)));

const codeFixtures = fixtures.filter(
  (f) => f.expectedCatch.startsWith('code:') && isPhase5Type(f.question.lockType),
);
const reviewFixtures = fixtures.filter(
  (f) => f.expectedCatch.startsWith('review:') && isPhase5Type(f.question.lockType),
);

function countMessage(what: string, expected: number, actual: number): string {
  return `${what}: expected ${expected}, actual ${actual}`;
}

function countByType(items: readonly unknown[], typeOf: (item: never) => unknown): Record<Phase5Type, number> {
  const out: Record<Phase5Type, number> = {
    'bone-ordering': 0,
    'bound-threads': 0,
    'cursed-object': 0,
    'combination-dial': 0,
  };
  for (const item of items) {
    const t = typeOf(item as never);
    if (isPhase5Type(t)) out[t] += 1;
  }
  return out;
}

describe('Phase 5 dataset counts', () => {
  const groups: ReadonlyArray<readonly [string, Readonly<Record<Phase5Type, number>>, Record<Phase5Type, number>]> = [
    [
      'dev questions',
      EXPECTED_DEV_QUESTIONS,
      countByType(phase5Of(devFiles), (q: { lockType?: unknown }) => q.lockType),
    ],
    [
      'sample questions',
      EXPECTED_SAMPLE_QUESTIONS,
      countByType(phase5Of(sampleFiles), (q: { lockType?: unknown }) => q.lockType),
    ],
    [
      'code:* fixtures',
      EXPECTED_CODE_FIXTURES,
      countByType(codeFixtures, (f: Fixture) => f.question.lockType),
    ],
    [
      'review:* fixtures',
      EXPECTED_REVIEW_FIXTURES,
      countByType(reviewFixtures, (f: Fixture) => f.question.lockType),
    ],
  ];

  for (const [label, expected, actual] of groups) {
    it.each(PHASE5_TYPES.map((t) => [t] as const))(`${label}: %s`, (type) => {
      expect(actual[type], countMessage(`${label} of ${type}`, expected[type], actual[type])).toBe(expected[type]);
    });
  }
});

describe('Phase 5 questions pass the blocking checks', () => {
  const contexts = new Map<string, EvidenceContext>();
  function contextFor(file: LoadedFile): EvidenceContext {
    let ctx = contexts.get(file.notesPath);
    if (!ctx) {
      ctx = contextFromNotes(readText(file.notesPath));
      contexts.set(file.notesPath, ctx);
    }
    return ctx;
  }

  it('parses and passes every question of the four new types with no blocking failure', () => {
    const problems: string[] = [];
    let checked = 0;
    for (const file of [...devFiles, ...sampleFiles]) {
      // Siblings come from the whole file so alternate checks see their primary.
      const all: AuthoringQuestion[] = [];
      for (const raw of file.data.questions) {
        const result = parseAuthoringQuestion(raw);
        if (!result.ok) {
          if (isPhase5Type((raw as { lockType?: unknown }).lockType)) {
            problems.push(`${file.name} ${(raw as { id?: string }).id}: schema ${result.error.path}`);
          }
          continue;
        }
        all.push(result.value);
      }
      const ctx = contextFor(file);
      for (const question of all) {
        if (!isPhase5Type(question.lockType)) continue;
        checked += 1;
        const siblings = all.filter((s) => s.conceptId === question.conceptId && s.id !== question.id);
        const failures = runChecks({ question, siblings, ...ctx }).filter((f) => blockingIds.has(f.checkId));
        if (failures.length > 0) {
          problems.push(`${file.name} ${question.id}: ${failures.map((f) => f.checkId).join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
    const expectedTotal = [...Object.values(EXPECTED_DEV_QUESTIONS), ...Object.values(EXPECTED_SAMPLE_QUESTIONS)].reduce(
      (a, b) => a + b,
      0,
    );
    expect(checked, countMessage('questions checked', expectedTotal, checked)).toBe(expectedTotal);
  });
});

// Fixtures are fed RAW, not schema-parsed: adv-08 carries a template the schema's closed enum
// rejects, so the checks must accept pre-schema input (see combination-dial-checks.test.ts).
function runFixture(f: Fixture): readonly string[] {
  const dir =
    f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
  const ctx = contextFromNotes(readText(`${dir}/${f.notes}`));
  const questions = [f.question, ...(f.roomContext ?? [])] as unknown as CheckableQuestion[];
  return runRoomChecks(questions, ctx)
    .filter((x) => x.questionId === f.question.id && blockingIds.has(x.checkId))
    .map((x) => x.checkId);
}

describe('Phase 5 adversarial fixtures', () => {
  it.each(codeFixtures.map((f) => [f.id, f] as const))(
    '%s fails with exactly its expected Check_ID',
    (_id, f) => {
      expect(runFixture(f)).toEqual([f.expectedCatch.slice('code:'.length)]);
    },
  );

  it.each(reviewFixtures.map((f) => [f.id, f] as const))(
    '%s passes the code checks (a review fixture is for the blind reviewer)',
    (_id, f) => {
      expect(runFixture(f)).toEqual([]);
    },
  );
});
