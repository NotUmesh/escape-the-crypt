import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { advisoryCheckIds, hintFor, implementedCheckIds } from '../src/check-hints';
import { HUMAN_HEART, POWER_DIR, newContext, prepareHeart, run } from './support';
import type { Json } from './support';

const REFERENCES = join(POWER_DIR, 'skills', 'grounded-quiz', 'references');

/** The JSON object in the fenced block that follows a `<!-- kind:name -->` marker. */
function blocksAfterMarkers(file: string, kind: string): Map<string, Json> {
  const text = readFileSync(join(REFERENCES, file), 'utf8');
  const out = new Map<string, Json>();
  for (const match of text.matchAll(new RegExp(`<!-- ${kind}:([\\w-]+) -->\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``, 'g'))) {
    out.set(match[1] ?? '', JSON.parse(match[2] ?? '{}') as Json);
  }
  return out;
}

const failing = (question: Json, ctx = newContext()): string[] => {
  const { notesId } = prepareHeart(ctx);
  return (run('check_question', { notesId, question }, ctx)['blocking'] as Json[]).map((f) => String(f['checkId']));
};

describe('question-formats.md', () => {
  const formats = blocksAfterMarkers('question-formats.md', 'format');

  it('shows one example for each of the six supported lock types', () => {
    expect([...formats.keys()]).toEqual(['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial']);
  });

  for (const lockType of ['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial']) {
    it(`the ${lockType} example passes check_question against samples/human-heart.txt`, () => {
      const ctx = newContext();
      const { notesId } = prepareHeart(ctx);
      const question = formats.get(lockType) as Json;
      expect(question['lockType']).toBe(lockType);
      expect(run('check_question', { notesId, question }, ctx)).toMatchObject({ valid: true, passes: true, blocking: [] });
    });
  }
});

describe('question-formats.md dial variants', () => {
  const variants = blocksAfterMarkers('question-formats.md', 'variant');
  it('shows an exact and a computed dial answer', () => {
    expect([...variants.keys()]).toEqual(['combination-dial-exact', 'combination-dial-template']);
  });
  for (const [name, question] of variants) {
    it(`the ${name} example passes check_question against samples/human-heart.txt`, () => {
      const ctx = newContext();
      const { notesId } = prepareHeart(ctx);
      expect(run('check_question', { notesId, question }, ctx)).toMatchObject({ valid: true, passes: true, blocking: [] });
    });
  }
  it('no longer says dial questions are unsupported', () => {
    for (const file of ['question-formats.md']) {
      expect(readFileSync(join(REFERENCES, file), 'utf8')).not.toMatch(/not supported here|no checks in this Power/i);
    }
  });
});
describe('worked-example.md', () => {
  const examples = blocksAfterMarkers('worked-example.md', 'example');
  const doc = readFileSync(join(REFERENCES, 'worked-example.md'), 'utf8');

  it('shows five questions', () => {
    expect([...examples.keys()]).toEqual(['draft-1', 'draft-2', 'draft-3', 'twin', 'second']);
  });

  it('quotes the real prepare_notes numbers and the real paragraph 6', () => {
    const { notesId, value } = prepareHeart(newContext());
    expect(doc).toContain(`"notesId": "${notesId}"`);
    expect(doc).toContain(`"wordCount": ${String(value['wordCount'])}`);
    expect(doc).toContain(`"paragraphCount": ${String(value['paragraphCount'])}`);
    const paragraph6 = String(((value['paragraphs'] as Json[])[5] as Json)['text']);
    expect(doc).toContain(paragraph6);
    expect(HUMAN_HEART).toContain(paragraph6.split(': ')[0] ?? '');
  });

  it('draft 1 fails only because its quote is not in the notes', () => {
    expect(failing(examples.get('draft-1') as Json)).toEqual(['quote-not-found']);
  });

  it('draft 2 fails only because its prompt gives the answer away', () => {
    expect(failing(examples.get('draft-2') as Json)).toEqual(['answer-leak-in-prompt']);
  });

  it('draft 3 passes', () => {
    expect(failing(examples.get('draft-3') as Json)).toEqual([]);
  });

  it('the twin passes alone, and fails with draft 3 as a pair, as the page says', () => {
    expect(failing(examples.get('twin') as Json)).toEqual([]);
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const pair = run('check_quiz', { notesId, questions: [examples.get('draft-3'), examples.get('twin')] }, ctx);
    expect(pair['passes']).toBe(false);
    expect(pair['summary']).toEqual({
      total: 2,
      passing: 0,
      failing: 2,
      invalid: 0,
      blockingByCheckId: { 'answer-leak-in-room': 2, 'duplicate-answer-in-room': 2 },
    });
  });

  it('draft 3 and the second question pass together', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const quiz = run('check_quiz', { notesId, questions: [examples.get('draft-3'), examples.get('second')] }, ctx);
    expect(quiz['passes']).toBe(true);
    expect((quiz['summary'] as Json)['passing']).toBe(2);
  });
});

describe('check advice', () => {
  it('has real advice for every check core implements, so a new check without help text fails here', () => {
    for (const id of implementedCheckIds()) {
      const hint = hintFor(id);
      expect(hint.problem.length, id).toBeGreaterThan(20);
      expect(hint.fix.length, id).toBeGreaterThan(10);
      expect(hint.problem, id).not.toContain('has no help text for failed');
    }
  });

  it('marks only alternate-off-concept as advisory', () => {
    expect([...advisoryCheckIds()]).toEqual(['alternate-off-concept']);
  });
});
