import { describe, expect, it } from 'vitest';
import { AuthoringQuestionSchema, type AuthoringQuestion } from '../authoring/schema';
import { conflictShownId, type ConflictResponse } from './conflict-prompt';
import { resolveConflictReports } from './conflict-report';
import { prepareDocument, type PreparedDocument } from './prepare-input';

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const repoRoot = `${here}/../../../..`;

// Read only: eval/adversarial/fixtures.json and its notes are never edited here.
const fixtures = (
  JSON.parse(fs.readFileSync(`${repoRoot}/eval/adversarial/fixtures.json`, 'utf8')) as {
    fixtures: { id: string; question: unknown }[];
  }
).fixtures;
const adv18 = AuthoringQuestionSchema.parse(fixtures.find((f) => f.id === 'adv-18')!.question);
const doc: PreparedDocument = prepareDocument(
  fs.readFileSync(`${repoRoot}/eval/adversarial/notes/adv-01-moon.txt`, 'utf8'),
);

function ordinalContaining(text: string): number {
  for (const [ordinal, chunk] of doc.quotableChunksByOrdinal) if (chunk.text.includes(text)) return ordinal;
  throw new Error(`no paragraph holds: ${text}`);
}

const P_27 = ordinalContaining('The Moon takes about 27 days to orbit Earth.');
const P_35 = ordinalContaining('takes about 35 days');
const P_TIDAL = ordinalContaining('always shows the same face');
const QUOTE_35 = 'One orbit of the Moon around Earth takes about 35 days.';

const report = (
  paragraph: number | null,
  quote: string | null,
  conflict = true,
  questionId = conflictShownId(0),
): ConflictResponse => ({ results: [{ questionId, conflict, paragraph, quote }] });

const resolve = (reply: ConflictResponse, room: readonly AuthoringQuestion[] = [adv18]) => {
  const r = resolveConflictReports(reply, room, doc);
  if (!r.ok) throw new Error(`unexpected schema failure: ${r.error.kind}`);
  return r.value;
};

const runeQuestion: AuthoringQuestion = AuthoringQuestionSchema.parse({
  id: 'mq-rune',
  conceptId: 'mq-c',
  role: 'primary',
  lockType: 'rune-cipher',
  prompt: 'According to your notes, the Moon always shows the same ______ to Earth.',
  answer: 'face',
  aliases: [],
  caseSensitive: false,
  evidence: [{ paragraph: P_TIDAL, quote: 'The Moon always shows the same face to Earth' }],
  explanation: '',
});

describe('resolveConflictReports: rules', () => {
  it('confirms the adv-18 conflict with both passages resolved by code', () => {
    const out = resolve(report(P_35, QUOTE_35));
    expect(out.conflictReportsIgnored).toBe(0);
    expect(out.confirmed).toHaveLength(1);
    const c = out.confirmed[0]!;
    expect(c.shownId).toBe('q1');
    expect(c.questionId).toBe('adv-18-q');
    expect(c.conceptId).toBe('adv-18-c');
    expect(c.own.quote).toBe('The Moon takes about 27 days to orbit Earth.');
    expect(c.own.chunkId).toBe(doc.quotableChunksByOrdinal.get(P_27)!.id);
    expect(c.other).toEqual({ chunkId: doc.quotableChunksByOrdinal.get(P_35)!.id, quote: QUOTE_35 });
  });

  it('does not count or confirm a report with conflict false', () => {
    const out = resolve(report(null, null, false));
    expect(out).toEqual({ confirmed: [], conflictReportsIgnored: 0 });
  });

  it('rule 1: ignores a paragraph that was not shown, or a missing paragraph or quote', () => {
    expect(resolve(report(999, QUOTE_35)).conflictReportsIgnored).toBe(1);
    expect(resolve(report(0, QUOTE_35)).conflictReportsIgnored).toBe(1);
    expect(resolve(report(null, QUOTE_35)).conflictReportsIgnored).toBe(1);
    expect(resolve(report(P_35, null)).conflictReportsIgnored).toBe(1);
  });

  it('rule 1: a quote from a different paragraph than the one named is ignored', () => {
    const out = resolve(report(P_TIDAL, QUOTE_35));
    expect(out.confirmed).toEqual([]);
    expect(out.conflictReportsIgnored).toBe(1);
  });

  it('rule 2: ignores a quote that is too short, ambiguous or longer than 25 words', () => {
    expect(resolve(report(P_35, 'about 35 days')).conflictReportsIgnored).toBe(1);
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');
    expect(resolve(report(P_35, long)).conflictReportsIgnored).toBe(1);
    const repeated = prepareDocument('Heading\n\nAlpha beta gamma delta 35 days. Alpha beta gamma delta 35 days.');
    const r = resolveConflictReports(report(1, 'Alpha beta gamma delta 35 days.'), [adv18], repeated);
    expect(r.ok && r.value.conflictReportsIgnored).toBe(1);
  });

  it('rule 3: ignores a quote that overlaps the question own evidence', () => {
    const out = resolve(report(P_27, 'takes about 27 days to orbit Earth'));
    expect(out.confirmed).toEqual([]);
    expect(out.conflictReportsIgnored).toBe(1);
  });

  it('rule 3 applies per question: another question evidence does not block a report', () => {
    const room = [runeQuestion, adv18];
    const reply: ConflictResponse = {
      results: [
        { questionId: 'q1', conflict: false, paragraph: null, quote: null },
        { questionId: 'q2', conflict: true, paragraph: P_TIDAL, quote: 'The Moon always shows the same face to Earth' },
      ],
    };
    // For q2 the tidal sentence has no differing number, so rule 4 ignores it; q1 is not reported.
    expect(resolve(reply, room).conflictReportsIgnored).toBe(1);
  });

  it('rule 4: a quote with no number different from the exact key is ignored', () => {
    const out = resolve(report(P_TIDAL, 'The Moon always shows the same face to Earth'));
    expect(out.confirmed).toEqual([]);
    expect(out.conflictReportsIgnored).toBe(1);
  });

  it('rule 4: for a range key the number must fall outside the range', () => {
    const range = AuthoringQuestionSchema.parse({
      ...adv18,
      answer: { kind: 'range', min: 26, max: 36 },
    });
    // 35 is inside 26..36, so it is not a conflicting number.
    expect(resolve(report(P_35, QUOTE_35), [range]).conflictReportsIgnored).toBe(1);
    const narrow = AuthoringQuestionSchema.parse({ ...adv18, answer: { kind: 'range', min: 26, max: 28 } });
    expect(resolve(report(P_35, QUOTE_35), [narrow]).confirmed).toHaveLength(1);
  });

  it('rule 4 does not apply to a question whose key is not a number', () => {
    const out = resolve(report(P_35, QUOTE_35), [runeQuestion]);
    expect(out.confirmed).toHaveLength(1);
  });

  it('ignores a conflict when the question has no resolvable evidence of its own', () => {
    const lost = AuthoringQuestionSchema.parse({
      ...adv18,
      evidence: [{ paragraph: P_27, quote: 'text that is not anywhere in the notes' }],
    });
    expect(resolve(report(P_35, QUOTE_35), [lost]).conflictReportsIgnored).toBe(1);
  });
});

describe('resolveConflictReports: reply shape', () => {
  const room = [adv18, runeQuestion];
  const entry = (questionId: string) => ({ questionId, conflict: false, paragraph: null, quote: null });

  it('returns a typed error, never throws, for a repeated id', () => {
    const r = resolveConflictReports({ results: [entry('q1'), entry('q1')] }, room, doc);
    expect(r).toEqual({ ok: false, error: { kind: 'conflict-reply-repeated-id', shownId: 'q1' } });
  });

  it('returns a typed error for a missing id', () => {
    const r = resolveConflictReports({ results: [entry('q2')] }, room, doc);
    expect(r).toEqual({ ok: false, error: { kind: 'conflict-reply-missing-id', shownId: 'q1' } });
  });

  it('returns a typed error for an id that was not shown', () => {
    const r = resolveConflictReports({ results: [entry('q1'), entry('q2'), entry('q9')] }, room, doc);
    expect(r).toEqual({ ok: false, error: { kind: 'conflict-reply-unknown-id', shownId: 'q9' } });
  });

  it('accepts one entry per id in any order', () => {
    const r = resolveConflictReports({ results: [entry('q2'), entry('q1')] }, room, doc);
    expect(r.ok).toBe(true);
  });
});

describe('adv-18 counter-cases and the recorded known gap', () => {
  it('ignores a quote that is not in the notes (rule 2)', () => {
    const out = resolve(report(P_35, 'The Moon needs exactly 35 days to circle the Earth.'));
    expect(out).toEqual({ confirmed: [], conflictReportsIgnored: 1 });
  });

  it("ignores paragraph 4's own 27-day sentence (rule 3)", () => {
    const out = resolve(report(P_27, 'The Moon takes about 27 days to orbit Earth.'));
    expect(out).toEqual({ confirmed: [], conflictReportsIgnored: 1 });
  });

  it('ignores a quote with no differing number (rule 4)', () => {
    const out = resolve(report(P_TIDAL, 'The Moon always shows the same face to Earth'));
    expect(out).toEqual({ confirmed: [], conflictReportsIgnored: 1 });
  });

  it('KNOWN GAP: a 29.5-day quote passes rules 1 to 4', () => {
    // The 29.5 days is the cycle of phases, a different quantity from the 27-day orbit. Code
    // cannot tell: 29.5 is a number different from 27, the quote resolves uniquely and it does
    // not overlap the evidence. Only the prompt wording ("a related but different quantity is
    // not a conflict") separates them. If a real model reports it, the concept is excluded
    // and the learner sees two passages: one question is lost, no wrong answer is published.
    const quote = 'takes about 29.5 days, because Earth is also moving around the Sun.';
    const out = resolve(report(P_27, quote));
    expect(out.conflictReportsIgnored).toBe(0);
    expect(out.confirmed).toHaveLength(1);
    expect(out.confirmed[0]!.other.quote).toBe(quote);
  });
});
