import { describe, expect, it } from 'vitest';
import { AuthoringQuestionSchema, type AuthoringQuestion } from '../authoring/schema';
import { leakScanRoom, type LeakScanRoomEntry } from './leak-scan';
import { visibleTextOf } from './run-checks';

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

function entry(q: AuthoringQuestion): LeakScanRoomEntry {
  return { conceptId: q.conceptId, question: q, visibleText: visibleTextOf(q) };
}

describe('answer-leak-in-room (adv-05)', () => {
  it('fails the rune cipher whose answer appears in another concept lock', async () => {
    const { question, context } = await loadFixture('adv-05');
    const failures = leakScanRoom([...context, question].map(entry));
    expect(failures).toEqual([{ checkId: 'answer-leak-in-room', questionId: question.id }]);
  });

  it('passes when the other concept does not mention the answer', async () => {
    const { question, context } = await loadFixture('adv-05');
    const clean = context.map((q) =>
      q.lockType === 'seance-board'
        ? {
            ...q,
            options: q.options.map((o) => ({ ...o, text: o.text.replace(/booster/i, 'top-up') })),
          }
        : q,
    );
    expect(leakScanRoom([...clean, question].map(entry))).toEqual([]);
  });

  it('ignores the same concept, so an alternate may mention its own answer', async () => {
    const { question, context } = await loadFixture('adv-05');
    const sameConcept = context.map((q) => ({ ...q, conceptId: question.conceptId }));
    expect(leakScanRoom([...sameConcept, question].map(entry))).toEqual([]);
  });

  it('matches on word boundaries only', async () => {
    const { question } = await loadFixture('adv-05');
    const other: LeakScanRoomEntry = {
      conceptId: 'other',
      question: { id: 'o', lockType: 'seance-board' },
      visibleText: ['Boosters and boosterish things'],
    };
    expect(leakScanRoom([entry(question), other])).toEqual([]);
  });
});
