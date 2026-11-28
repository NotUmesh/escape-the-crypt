import { beforeAll, describe, expect, it } from 'vitest';
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
import { manifestCheck } from './runtime/manifest-check';
import { parseManifest } from './runtime/manifest-schema';
import { buildHumanHeartSampleCrypt } from './sample-crypt/human-heart';
import type { HumanHeartQuestionsFile } from './sample-crypt/human-heart';

// Phase 1 dataset sizes (Req 9.1 to 9.4).
// 57 and 27: https.json gained one rune cipher question (hs-q10) so the HTTPS sample can place all six lock types.
const EXPECTED_QUESTION_COUNT = 57;
const EXPECTED_RUNE_CIPHER_COUNT = 27;
const EXPECTED_SEANCE_BOARD_COUNT = 30;
const EXPECTED_CODE_FIXTURE_COUNT = 10;
const EXPECTED_REVIEW_FIXTURE_COUNT = 4;

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
  readonly status?: string;
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

function isPhase1Type(lockType: unknown): boolean {
  return lockType === 'rune-cipher' || lockType === 'seance-board';
}

const devFiles = loadQuestionFiles('eval/dev/questions', 'eval/dev/notes');
const sampleFiles = loadQuestionFiles('samples/questions', 'samples');
const allFiles = [...devFiles, ...sampleFiles];
const fixtures = (JSON.parse(readText('eval/adversarial/fixtures.json')) as { fixtures: Fixture[] })
  .fixtures;

/** Rune cipher and séance board questions only; the other four types are Phase 5. */
const phase1Questions = allFiles.flatMap((file) =>
  file.data.questions
    .filter((q) => isPhase1Type((q as { lockType?: unknown }).lockType))
    .map((q) => ({ file, raw: q })),
);

const codeFixtures = fixtures.filter(
  (f) => f.expectedCatch.startsWith('code:') && isPhase1Type(f.question.lockType),
);
const reviewFixtures = fixtures.filter(
  (f) => f.expectedCatch.startsWith('review:') && isPhase1Type(f.question.lockType),
);

function countMessage(what: string, expected: number, actual: number): string {
  return `${what}: expected ${expected}, actual ${actual}`;
}

describe('Phase 1 dataset counts (Req 9.1, 9.2, 9.3)', () => {
  const countOf = (type: string): number =>
    phase1Questions.filter((q) => (q.raw as { lockType: string }).lockType === type).length;

  it('has the expected number of Phase 1 questions', () => {
    expect(phase1Questions.length, countMessage('questions', EXPECTED_QUESTION_COUNT, phase1Questions.length)).toBe(
      EXPECTED_QUESTION_COUNT,
    );
  });
  it('has the expected number of rune cipher questions', () => {
    expect(countOf('rune-cipher'), countMessage('rune cipher questions', EXPECTED_RUNE_CIPHER_COUNT, countOf('rune-cipher'))).toBe(
      EXPECTED_RUNE_CIPHER_COUNT,
    );
  });
  it('has the expected number of séance board questions', () => {
    expect(countOf('seance-board'), countMessage('séance board questions', EXPECTED_SEANCE_BOARD_COUNT, countOf('seance-board'))).toBe(
      EXPECTED_SEANCE_BOARD_COUNT,
    );
  });
  it('has the expected number of code:* and review:* fixtures', () => {
    expect(codeFixtures.length, countMessage('code:* fixtures', EXPECTED_CODE_FIXTURE_COUNT, codeFixtures.length)).toBe(
      EXPECTED_CODE_FIXTURE_COUNT,
    );
    expect(reviewFixtures.length, countMessage('review:* fixtures', EXPECTED_REVIEW_FIXTURE_COUNT, reviewFixtures.length)).toBe(
      EXPECTED_REVIEW_FIXTURE_COUNT,
    );
  });
});

describe('Phase 1 questions pass the blocking checks (Req 9.1, 9.2)', () => {
  const contexts = new Map<string, EvidenceContext>();
  function contextFor(file: LoadedFile): EvidenceContext {
    let ctx = contexts.get(file.notesPath);
    if (!ctx) {
      ctx = contextFromNotes(readText(file.notesPath));
      contexts.set(file.notesPath, ctx);
    }
    return ctx;
  }

  it('parses and passes every question with no blocking failure', () => {
    const problems: string[] = [];
    for (const file of allFiles) {
      const parsed: AuthoringQuestion[] = [];
      for (const raw of file.data.questions) {
        if (!isPhase1Type((raw as { lockType?: unknown }).lockType)) continue;
        const result = parseAuthoringQuestion(raw);
        if (!result.ok) {
          problems.push(`${file.name} ${(raw as { id?: string }).id}: schema ${result.error.path}`);
          continue;
        }
        parsed.push(result.value);
      }
      const ctx = contextFor(file);
      for (const question of parsed) {
        const siblings = parsed.filter((s) => s.conceptId === question.conceptId && s.id !== question.id);
        const failures = runChecks({ question, siblings, ...ctx }).filter((f) => blockingIds.has(f.checkId));
        if (failures.length > 0) {
          problems.push(`${file.name} ${question.id}: ${failures.map((f) => f.checkId).join(', ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

function runFixture(f: Fixture): readonly string[] {
  const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : 'eval/dev/notes';
  const ctx = contextFromNotes(readText(`${dir}/${f.notes}`));
  const questions = [f.question, ...(f.roomContext ?? [])] as unknown as CheckableQuestion[];
  return runRoomChecks(questions, ctx)
    .filter((x) => x.questionId === f.question.id && blockingIds.has(x.checkId))
    .map((x) => x.checkId);
}

describe('adversarial fixtures (Req 9.3, 9.4, 9.6)', () => {
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

describe('sample crypt (Req 9.7, 9.9)', () => {
  let manifest: ReturnType<typeof buildHumanHeartSampleCrypt>;

  beforeAll(() => {
    const file = JSON.parse(readText('samples/questions/human-heart.json')) as HumanHeartQuestionsFile;
    manifest = buildHumanHeartSampleCrypt(readText('samples/human-heart.txt'), file);
  });

  it('builds, and passes the manifest schema and manifestCheck', () => {
    if (!manifest.ok) throw new Error(`sample crypt build failed: ${JSON.stringify(manifest.error)}`);
    expect(parseManifest(JSON.parse(JSON.stringify(manifest.value.manifest))).ok).toBe(true);
    expect(manifestCheck(manifest.value.manifest)).toEqual({ ok: true });
  });
});
