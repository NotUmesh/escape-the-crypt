import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CassetteFile } from '@escape-the-crypt/core';
import { DEV_CASSETTES_DIR, DEV_NOTES_DIR, RESULTS_DIR } from './paths';
import { EvaluationResultSchema, type EvaluationResult } from './result-file';

/**
 * A small, fully fake run for the rater tooling tests: one note, four concepts, no model calls.
 * Concept 0: rune (accepted) + séance (accepted). Concept 1: rune (code-check rejected) + bone
 * ordering (review rejected). Concept 2: the model chose no lock. Concept 3: dial (accepted) +
 * cursed object (not reviewed, so it is never exported).
 */
export const FIXTURE_NOTE = 'dev-77-fixture.txt';
export const FIXTURE_RESULT = 'fixture.json';
export const FIXTURE_RUN_ID = 'fixture-run';
export const FIXTURE_MODEL = 'gpt-fixture';

const hex = (label: string): string => createHash('sha256').update(label).digest('hex');
const ev = (quote: string) => ({ chunkId: 'c1', quote });

export const RUNE_Q = {
  lockType: 'rune-cipher',
  prompt: 'According to your notes, a substance that trains the immune system is a ____.',
  answer: 'vaccine',
  aliases: ['a vaccine'],
  caseSensitive: false,
  evidence: [ev('A vaccine trains the immune system.')],
  explanation: 'The notes define it.',
  hint: null,
};
export const SEANCE_Q = {
  lockType: 'seance-board',
  prompt: 'According to your notes, which statement is true?',
  options: [
    { id: 'a', text: 'Vaccines train the immune system', label: 'supported', evidence: ev('A vaccine trains the immune system.') },
    { id: 'b', text: 'Vaccines cure every disease', label: 'contradicted', evidence: ev('Vaccines prevent some diseases.') },
    { id: 'c', text: 'Vaccines are antibiotics', label: 'contradicted', evidence: ev('Antibiotics are different.') },
  ],
  answer: 'a',
  explanation: 'Option a is quoted.',
};
const NEGATIVE_RUNE_Q = { ...RUNE_Q, prompt: 'According to your notes, which is NOT a vaccine use? ____', answer: 'antibiotic' };
const BONE_Q = {
  lockType: 'bone-ordering',
  prompt: 'According to your notes, put the steps in order.',
  steps: ['Exposure', 'Response', 'Memory'],
  evidence: [ev('First exposure, then response, then memory.')],
  explanation: 'Stated order.',
};
const DIAL_Q = {
  lockType: 'combination-dial',
  prompt: 'According to your notes, how many doses are given?',
  answer: { kind: 'exact', value: 2 },
  units: 'doses',
  evidence: [ev('Two doses are given.')],
  explanation: 'Stated number.',
};
const CURSED_Q = {
  lockType: 'cursed-object',
  prompt: 'According to your notes, which is not a vaccine type?',
  items: ['live', 'inactivated', 'mRNA', 'antibiotic'],
  answer: 'antibiotic',
  categoryRule: 'vaccine types',
  evidence: [ev('Vaccine types are live, inactivated and mRNA.')],
  explanation: 'Listed types.',
};

const reply = (primary: unknown, alternate: unknown) => ({ justification: 'fits', primary, alternate });
const entry = (label: string, json: unknown) => ({ digest: hex(label), origin: 'recorded' as const, response: { ok: true as const, json, usage: { inputTokens: 1, outputTokens: 1 } } });

export interface Fixture {
  readonly result: EvaluationResult;
  readonly cassette: CassetteFile;
}

/** `override` replaces a generation reply, to make a prompt that needs escaping or a mismatch. */
export function buildFixture(override: { readonly gen0Primary?: unknown } = {}): Fixture {
  const gen0 = reply(override.gen0Primary ?? RUNE_Q, SEANCE_Q);
  const cassette: CassetteFile = {
    checkVersion: 'fixture',
    entries: [
      entry('extract', { concepts: [{ title: 'one' }] }),
      entry('gen0', gen0),
      entry('gen1', reply(NEGATIVE_RUNE_Q, BONE_Q)),
      entry('gen2', reply(null, null)),
      entry('gen3', reply(DIAL_Q, CURSED_Q)),
      entry('review0', { verdict: 'pass' }),
    ],
  };
  const cand = (conceptIndex: number, role: 'primary' | 'alternate', lockType: string, result: string, extra: object = {}) => ({
    conceptIndex,
    conceptId: `concept-${conceptIndex}`,
    role,
    lockType,
    result,
    checkIds: [],
    reviewReason: null,
    mapperReason: null,
    placement: result === 'accepted' ? 'slot-lead' : null,
    ...extra,
  });
  const result = EvaluationResultSchema.parse({
    schemaVersion: 1,
    runId: FIXTURE_RUN_ID,
    startedAt: '2026-11-27T10:00:00.000Z',
    finishedAt: '2026-11-27T10:01:00.000Z',
    set: 'dev',
    provider: 'openai',
    modelId: FIXTURE_MODEL,
    temperature: 0.2,
    checkVersion: 'fixture',
    assemblyPolicy: { promoteAlternates: true, dedupeAnswers: true },
    prices: { inputUsdPerMTok: 1, outputUsdPerMTok: 1 },
    budget: { capUsd: 1, spentBeforeUsd: 0, spentThisRunUsd: 0, reservationRefused: false },
    stopped: 'completed',
    notes: [
      {
        note: FIXTURE_NOTE,
        ok: true,
        errorKind: null,
        promptDigests: ['extract', 'gen0', 'gen1', 'gen2', 'gen3', 'review0'].map(hex),
        liveCalls: 0,
        replayedCalls: 6,
        stageTimingsMs: {},
        tokens: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        concepts: [
          { conceptIndex: 0, conceptId: 'concept-0', generation: 'questions' },
          { conceptIndex: 1, conceptId: 'concept-1', generation: 'questions' },
          { conceptIndex: 2, conceptId: 'concept-2', generation: 'no-lock' },
          { conceptIndex: 3, conceptId: 'concept-3', generation: 'questions' },
        ],
        candidates: [
          cand(0, 'primary', 'rune-cipher', 'accepted'),
          cand(0, 'alternate', 'seance-board', 'accepted'),
          cand(1, 'primary', 'rune-cipher', 'code-check-rejected', { checkIds: ['negative-question'] }),
          cand(1, 'alternate', 'bone-ordering', 'review-rejected', { reviewReason: 'answer-mismatch' }),
          cand(3, 'primary', 'combination-dial', 'accepted'),
          cand(3, 'alternate', 'cursed-object', 'not-reviewed'),
        ],
        codeCheckRejections: {},
        room: null,
      },
    ],
  });
  return { result, cassette };
}

export interface FakeRepo {
  readonly root: string;
  readonly resultsDir: string;
}

/** A temp repository root holding the fixture result, its OpenAI dev cassette and one dev note. */
export function fakeRepoWithFixture(fixture: Fixture = buildFixture()): FakeRepo {
  const root = mkdtempSync(join(tmpdir(), 'ratings-'));
  const resultsDir = join(root, RESULTS_DIR);
  const cassettes = join(root, DEV_CASSETTES_DIR);
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(cassettes, { recursive: true });
  mkdirSync(join(root, DEV_NOTES_DIR), { recursive: true });
  writeFileSync(join(root, DEV_NOTES_DIR, FIXTURE_NOTE), 'Some notes.');
  writeFileSync(join(resultsDir, FIXTURE_RESULT), `${JSON.stringify(fixture.result, null, 2)}\n`);
  writeFileSync(join(cassettes, FIXTURE_NOTE.replace(/\.txt$/, '.json')), `${JSON.stringify(fixture.cassette, null, 2)}\n`);
  return { root, resultsDir };
}
