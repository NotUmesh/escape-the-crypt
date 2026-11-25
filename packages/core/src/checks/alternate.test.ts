import { describe, expect, it } from 'vitest';
import { AuthoringQuestionSchema, type AuthoringQuestion } from '../authoring/schema';
import {
  checkAlternate,
  checkAlternateOffConcept,
  checkAlternateSameLockType,
  checkMaxOneAlternate,
} from './alternate';
import type { Chunk } from '../types';
import type { QuoteContext } from './evidence';
import { CHECK_REGISTRY } from './registry';
import type { CheckFailure } from './types';

interface Fixture {
  readonly id: string;
  readonly roomContext?: readonly unknown[];
  readonly question: unknown;
}

// packages/core compiles without Node types, so load Node modules dynamically.
async function loadFixture(
  id: string,
): Promise<{ question: AuthoringQuestion; context: AuthoringQuestion[] }> {
  const fsSpecifier: string = 'node:fs';
  const urlSpecifier: string = 'node:url';
  const fs = (await import(fsSpecifier)) as unknown as {
    readFileSync(path: string, enc: string): string;
  };
  const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
  const href = (import.meta as unknown as { url: string }).url;
  const here = url
    .fileURLToPath(href)
    .replace(/\\/g, '/')
    .replace(/\/[^/]*$/, '');
  const text = fs.readFileSync(`${here}/../../../../eval/adversarial/fixtures.json`, 'utf8');
  const parsed = JSON.parse(text) as { fixtures: Fixture[] };
  const fixture = parsed.fixtures.find((f) => f.id === id);
  if (!fixture) throw new Error(`missing fixture ${id}`);
  return {
    question: AuthoringQuestionSchema.parse(fixture.question),
    context: (fixture.roomContext ?? []).map((q) => AuthoringQuestionSchema.parse(q)),
  };
}

function rune(
  id: string,
  conceptId: string,
  role: 'primary' | 'alternate',
  answer: string,
  quote: string,
): AuthoringQuestion {
  return {
    id,
    conceptId,
    role,
    lockType: 'rune-cipher',
    prompt: `According to your notes, the term is ______ (${id}).`,
    answer,
    aliases: [],
    caseSensitive: false,
    evidence: [{ paragraph: 1, quote }],
    explanation: '-',
  };
}

function seance(
  id: string,
  conceptId: string,
  role: 'primary' | 'alternate',
  quote: string,
): AuthoringQuestion {
  const option = (oid: string, label: 'supported' | 'contradicted', q: string) => ({
    id: oid,
    text: `Option ${oid}`,
    label,
    evidence: { paragraph: 1, quote: q },
  });
  return {
    id,
    conceptId,
    role,
    lockType: 'seance-board',
    prompt: 'According to your notes, which statement holds?',
    options: [
      option('a', 'supported', quote),
      option('b', 'contradicted', 'Something else entirely is written here'),
      option('c', 'contradicted', 'Another unrelated sentence from the notes'),
    ],
    answer: 'a',
    explanation: '-',
  };
}

const QUOTE = 'alpha is the first letter';

const CHUNK: Chunk = {
  id: 'chk_alt_0',
  documentDigest: 'alt',
  position: 0,
  text: 'Note: alpha is the first letter. Quantum tunnelling crosses barriers. Beta is next.',
  location: { sourceType: 'paste', paragraphNumber: 1 },
  edited: false,
};
const CONTEXT: QuoteContext = {
  chunks: new Map([[CHUNK.id, CHUNK]]),
  paragraphChunkIds: new Map([[1, CHUNK.id]]),
};
const EMPTY: QuoteContext = { chunks: new Map(), paragraphChunkIds: new Map() };

describe('alternate-same-lock-type (adv-11)', () => {
  it('fails an alternate that shares its primary lock type', async () => {
    const { question, context } = await loadFixture('adv-11');
    const [primary] = context;
    if (!primary) throw new Error('adv-11 has no primary in roomContext');
    expect(checkAlternateSameLockType(primary, question)).toEqual([
      { checkId: 'alternate-same-lock-type', questionId: question.id },
    ]);
    expect(checkAlternate(primary, question, EMPTY).map((f) => f.checkId)).toContain(
      'alternate-same-lock-type',
    );
  });

  it('passes an alternate of a different lock type', () => {
    const primary = rune('p', 'c1', 'primary', 'alpha', QUOTE);
    const alternate = seance('a', 'c1', 'alternate', QUOTE);
    expect(checkAlternateSameLockType(primary, alternate)).toEqual([]);
  });
});

describe('max-one-alternate', () => {
  const primary = rune('p', 'c1', 'primary', 'alpha', QUOTE);
  const alt1 = seance('alt1', 'c1', 'alternate', QUOTE);
  const alt2 = seance('alt2', 'c1', 'alternate', QUOTE);

  it('fails the second alternate of one concept', () => {
    expect(checkMaxOneAlternate('c1', [primary, alt1, alt2])).toEqual([
      { checkId: 'max-one-alternate', questionId: 'alt2' },
    ]);
  });

  it('passes one alternate, and ignores alternates of other concepts', () => {
    expect(checkMaxOneAlternate('c1', [primary, alt1])).toEqual([]);
    const other: AuthoringQuestion = { ...alt2, conceptId: 'c2' };
    expect(checkMaxOneAlternate('c1', [primary, alt1, other])).toEqual([]);
  });
});

describe('alternate-off-concept (advisory)', () => {
  const primary = rune('p', 'c1', 'primary', 'alpha', QUOTE);
  const offConcept = seance('off', 'c1', 'alternate', 'Quantum tunnelling crosses barriers');

  it('returns an advisory failure for an alternate quoting unrelated evidence', () => {
    expect(checkAlternateOffConcept(primary, offConcept, CONTEXT)).toEqual([
      { checkId: 'alternate-off-concept', questionId: 'off' },
    ]);
  });

  it('passes an alternate quoting the concept evidence', () => {
    const onConcept = seance('on', 'c1', 'alternate', QUOTE);
    expect(checkAlternateOffConcept(primary, onConcept, CONTEXT)).toEqual([]);
  });

  it('does not run when the answer-bearing quote of the alternate did not resolve', () => {
    const unresolved = seance('un', 'c1', 'alternate', 'This sentence is not in the notes at all');
    expect(checkAlternateOffConcept(primary, unresolved, CONTEXT)).toEqual([]);
  });

  it('is registered advisory" and never appears in the blocking-only list', () => {
    const severityOf = new Map(CHECK_REGISTRY.map((r) => [r.id, r.severity]));
    expect(severityOf.get('alternate-off-concept')).toBe('advisory');
    const failures: CheckFailure[] = checkAlternate(primary, offConcept, CONTEXT);
    expect(failures.map((f) => f.checkId)).toContain('alternate-off-concept');
    const blocking = failures.filter((f) => severityOf.get(f.checkId) === 'blocking');
    expect(blocking).toEqual([]);
  });
});
