import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../chunker';
import type { Chunk } from '../types';
import { duplicateAnswerCase } from '../test-support/duplicate-answer-case';
import { CHECK_REGISTRY, CHECK_VERSION } from './registry';
import {
  runChecks,
  runRoomChecks,
  type CheckableQuestion,
  type EvidenceContext,
  type UnsupportedQuestion,
} from './run-checks';
import type { CheckFailure, CheckId } from './types';

/** The literal Req 3.5 list, in the order the requirement gives it. */
const REQ_3_5_CHECK_IDS: readonly string[] = [
  'quote-not-found', 'quote-ambiguous', 'quote-too-short',
  'quote-too-long', 'unknown-paragraph/chunk', 'missing-according-to-your-notes',
  'negative-question', 'banned-phrase', 'answer-not-in-quote',
  'rune-needs-one-blank', 'answer-leak-in-prompt', 'answer-leak-in-room', 'duplicate-answer-in-room',
  'option-count', 'option-not-supported-or-contradicted', 'option-without-evidence',
  'not-exactly-one-supported', 'key-not-the-supported-option', 'duplicate-options',
  'step-count', 'duplicate-steps', 'no-explicit-sequence-marker-in-quotes',
  'pair-count', 'not-one-to-one', 'item-count',
  'answer-not-an-item', 'missing-category-rule', 'needs-category-and-outside-quotes',
  'missing-units', 'number-not-in-quote', 'range-not-in-quote',
  'template-not-allowlisted', 'template-input-not-in-quote', 'template-value-mismatch',
  'model-written-expression', 'alternate-same-lock-type', 'max-one-alternate',
  'dial-range-prompt', 'alternate-off-concept', 'lock-type-not-supported',
];

const PHASE_5_LOCK_TYPES = [
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
] as const;

const registryIds = CHECK_REGISTRY.map((r) => r.id as string);
describe('check registry', () => {
  it('has exactly the Req 3.5 Check_IDs, with no missing, extra or duplicate id', () => {
    const missing = REQ_3_5_CHECK_IDS.filter((id) => !registryIds.includes(id));
    const extra = registryIds.filter((id) => !REQ_3_5_CHECK_IDS.includes(id));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(new Set(registryIds).size).toBe(registryIds.length);
    expect(registryIds).toHaveLength(REQ_3_5_CHECK_IDS.length);
  });

  it('exposes CHECK_VERSION 2026-11-27.1', () => expect(CHECK_VERSION).toBe('2026-11-27.1'));

  it('marks only alternate-off-concept as advisory', () => {
    const advisory = CHECK_REGISTRY.filter((r) => r.severity === 'advisory').map((r) => r.id);
    expect(advisory).toEqual(['alternate-off-concept']);
  });
});

// ---------------------------------------------------------------------------
// Implementation status (Req 3.14)
// ---------------------------------------------------------------------------

interface Fixture {
  readonly id: string;
  readonly notes: string;
  readonly notesDir?: string;
  readonly expectedCatch: string;
  readonly roomContext?: readonly unknown[];
  readonly question: { readonly id: string; readonly lockType: string };
}

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const metaUrl = (import.meta as unknown as { url: string }).url;
const here = url.fileURLToPath(metaUrl).replace(/\\/g, '/').replace(/\/[^/]*$/, '');

function readRepoFile(relative: string): string {
  return fs.readFileSync(`${here}/../../../../${relative}`, 'utf8');
}

const fixtures = (
  JSON.parse(readRepoFile('eval/adversarial/fixtures.json')) as { fixtures: Fixture[] }
).fixtures;

/** Builds the chunk map and the paragraph number -> chunk ID map for a notes text. */
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

/** Only eval/dev and eval/adversarial notes are read here, never the final test set. */
function fixtureContext(f: Fixture): EvidenceContext {
  const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : 'eval/dev/notes';
  return contextFromNotes(readRepoFile(`${dir}/${f.notes}`));
}

function runFixture(id: string): readonly CheckFailure[] {
  const f = fixtures.find((x) => x.id === id);
  if (!f) throw new Error(`missing fixture ${id}`);
  const questions = [f.question, ...(f.roomContext ?? [])] as CheckableQuestion[];
  return runRoomChecks(questions, fixtureContext(f)).filter((x) => x.questionId === f.question.id);
}

// Synthetic evidence for ids with no code:* fixture.
const SYNTH_CHUNK: Chunk = {
  id: 'chk_synth_0',
  documentDigest: 'synth',
  position: 0,
  text:
    'Mitochondria produce most of the energy a cell uses. Ribosomes build proteins from amino acids. ' +
    'The nucleus stores the genetic material of the cell. ' +
    Array.from({ length: 30 }, (_, i) => `word${i + 1}`).join(' '),
  location: { sourceType: 'paste', paragraphNumber: 1 },
  edited: false,
};
const SYNTH: EvidenceContext = {
  chunks: new Map([[SYNTH_CHUNK.id, SYNTH_CHUNK]]),
  paragraphChunkIds: new Map([[1, SYNTH_CHUNK.id]]),
};
const Q_ENERGY = 'Mitochondria produce most of the energy';
const Q_PROTEINS = 'Ribosomes build proteins from amino acids';
const Q_NUCLEUS = 'The nucleus stores the genetic material';

type Overrides = Record<string, unknown>;

function rune(overrides: Overrides = {}): CheckableQuestion {
  return {
    id: 'q',
    conceptId: 'c',
    role: 'primary',
    lockType: 'rune-cipher',
    prompt: 'According to your notes, the ______ produce most of the energy.',
    answer: 'Mitochondria',
    aliases: [],
    caseSensitive: false,
    evidence: [{ paragraph: 1, quote: Q_ENERGY }],
    explanation: '-',
    ...overrides,
  } as CheckableQuestion;
}

function option(id: string, label: string, quote: string, text = `Option ${id}`): unknown {
  return { id, text, label, evidence: { paragraph: 1, quote } };
}

function seance(overrides: Overrides = {}): CheckableQuestion {
  return {
    id: 'q',
    conceptId: 'c',
    role: 'primary',
    lockType: 'seance-board',
    prompt: 'According to your notes, which part makes the energy?',
    options: [
      option('a', 'supported', Q_ENERGY),
      option('b', 'contradicted', Q_PROTEINS),
      option('c', 'contradicted', Q_NUCLEUS),
    ],
    answer: 'a',
    explanation: '-',
    ...overrides,
  } as CheckableQuestion;
}

function synth(questions: readonly CheckableQuestion[]): readonly CheckFailure[] {
  return runRoomChecks(questions, SYNTH).filter((f) => f.questionId === 'q');
}

const SYNTHETIC_CASES: Partial<Record<CheckId, () => readonly CheckFailure[]>> = {
  'duplicate-answer-in-room': duplicateAnswerCase,
  'quote-too-long': () =>
    synth([
      rune({
        prompt: 'According to your notes, the third word is ______.',
        answer: 'word3',
        evidence: [
          { paragraph: 1, quote: Array.from({ length: 26 }, (_, i) => `word${i + 1}`).join(' ') },
        ],
      }),
    ]),
  'unknown-paragraph/chunk': () =>
    synth([rune({ evidence: [{ paragraph: 99, quote: Q_ENERGY }] })]),
  'banned-phrase': () => synth([rune({ explanation: 'This answer is guaranteed.' })]),
  'rune-needs-one-blank': () =>
    synth([rune({ prompt: 'According to your notes, what produces most of the energy?' })]),
  'answer-leak-in-prompt': () =>
    synth([
      rune({ prompt: 'According to your notes, Mitochondria produce most of the ______ energy.' }),
    ]),
  'missing-according-to-your-notes': () =>
    synth([seance({ prompt: 'Which part makes the energy?' })]),
  'option-count': () =>
    synth([
      seance({
        options: [option('a', 'supported', Q_ENERGY), option('b', 'contradicted', Q_PROTEINS)],
      }),
    ]),
  'duplicate-options': () =>
    synth([
      seance({
        options: [
          option('a', 'supported', Q_ENERGY, 'Same text'),
          option('b', 'contradicted', Q_PROTEINS, 'same  text'),
          option('c', 'contradicted', Q_NUCLEUS),
        ],
      }),
    ]),
  'option-without-evidence': () =>
    synth([
      seance({
        options: [
          option('a', 'supported', Q_ENERGY),
          option('b', 'contradicted', ''),
          option('c', 'contradicted', Q_NUCLEUS),
        ],
      }),
    ]),
  'key-not-the-supported-option': () => synth([seance({ answer: 'b' })]),
  'max-one-alternate': () =>
    synth([
      seance({ id: 'p', role: 'primary' }),
      rune({ id: 'a-first', role: 'alternate' }),
      rune({ id: 'q', role: 'alternate' }),
    ]),
  'alternate-off-concept': () =>
    synth([
      rune({ id: 'p', role: 'primary' }),
      seance({
        role: 'alternate',
        options: [
          option('a', 'supported', Q_PROTEINS),
          option('b', 'contradicted', Q_NUCLEUS),
          option('c', 'contradicted', 'word1 word2 word3 word4'),
        ],
      }),
    ]),
  'lock-type-not-supported': () =>
    runChecks({
      ...SYNTH,
      question: { id: 'q', conceptId: 'c', role: 'primary', lockType: 'bone-ordering' },
    }),
};

/** The `code:<id>` fixture for a Check_ID on a supported lock type, if one exists. */
function fixtureFor(id: string): Fixture | undefined {
  return fixtures.find(
    (f) =>
      f.expectedCatch === `code:${id}` &&
      (f.question.lockType === 'rune-cipher' || f.question.lockType === 'seance-board'),
  );
}

const phase1Entries = CHECK_REGISTRY.filter(
  (r) => r.scope === 'shared' || r.scope.some((t) => t === 'rune-cipher' || t === 'seance-board'),
);
const implementedIds = phase1Entries.map((r) => r.id);

describe('implementation status (Req 3.14)', () => {
  it('registers every rune cipher, séance board and shared id as implemented', () => {
    expect(phase1Entries.filter((r) => !r.implemented).map((r) => r.id)).toEqual([]);
    expect(implementedIds.length).toBeGreaterThan(0);
  });

  it.each(implementedIds)('runChecks / runRoomChecks reports %s on a question that trips it', (id) => {
    const fixture = fixtureFor(id);
    const synthetic = SYNTHETIC_CASES[id];
    expect(fixture !== undefined || synthetic !== undefined, `no test input for ${id}`).toBe(true);
    const failures = fixture ? runFixture(fixture.id) : synthetic!();
    expect(failures.map((f) => f.checkId)).toContain(id);
  });

  it('marks every id scoped to a Phase 5 lock type as not implemented', () => {
    const phase5 = CHECK_REGISTRY.filter(
      (r) => r.scope !== 'shared' && r.scope.some((t) => (PHASE_5_LOCK_TYPES as readonly string[]).includes(t)),
    );
    expect(phase5.length).toBeGreaterThan(0);
    expect(phase5.filter((r) => r.implemented).map((r) => r.id)).toEqual([]);
  });

  it.each(PHASE_5_LOCK_TYPES)(
    'fails a generated %s question with exactly lock-type-not-supported',
    (lockType) => {
      const phase5Ids = new Set<string>(
        CHECK_REGISTRY.filter(
          (r) => r.scope !== 'shared' && r.scope.some((t) => t === lockType),
        ).map((r) => r.id),
      );
      const question: UnsupportedQuestion = { id: 'q', conceptId: 'c', role: 'primary', lockType };
      const failures = runChecks({ ...SYNTH, question });
      expect(failures).toEqual([{ checkId: 'lock-type-not-supported', questionId: 'q' }]);
      expect(failures.some((f) => phase5Ids.has(f.checkId))).toBe(false);
    },
  );
});
