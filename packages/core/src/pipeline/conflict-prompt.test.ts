import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES } from '../copy';
import { toModelJsonSchema } from '../provider/model-json-schema';
import { z } from '../zod';
import { heart, runeQuestion, seanceQuestion } from './blind-review-fixtures';
import {
  CONFLICT_CHECK_PROMPT_VERSION,
  CONFLICT_CHECK_SYSTEM_PROMPT,
  ConflictResponseSchema,
  buildConflictUserMessage,
  buildRetryNote,
  conflictShownId,
} from './conflict-prompt';
import { DATA_DELIMITER_LINE, NOTES_CLOSE, NOTES_OPEN } from './concept-extraction-prompt';

function findBanned(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_COPY_PHRASES.filter((p) => lower.includes(p.toLowerCase()));
}

const questions = [runeQuestion(), seanceQuestion()];

describe('conflict prompt', () => {
  it('has the pinned version', () => {
    expect(CONFLICT_CHECK_PROMPT_VERSION).toBe('conflict-v1');
  });

  it('system prompt treats notes as data and asks for exact 4 to 25 word quotes', () => {
    expect(CONFLICT_CHECK_SYSTEM_PROMPT).toContain(DATA_DELIMITER_LINE);
    expect(CONFLICT_CHECK_SYSTEM_PROMPT).toContain('4 to 25 words');
    expect(CONFLICT_CHECK_SYSTEM_PROMPT).toContain('related but different quantity is not a conflict');
  });

  it('delimits the notes block and numbers paragraphs by ordinal', () => {
    const message = buildConflictUserMessage(questions, heart);
    expect(message.split(NOTES_OPEN).length).toBe(2);
    expect(message.indexOf(NOTES_OPEN)).toBeLessThan(message.indexOf(NOTES_CLOSE));
    const ordinal = [...heart.quotableChunksByOrdinal.keys()][0];
    expect(message).toContain(`[chunk ${ordinal}]`);
  });

  it('shows ids, prompt, answer line and evidence, and nothing else of the key', () => {
    const message = buildConflictUserMessage(questions, heart);
    expect(message).toContain(`Question ${conflictShownId(0)}`);
    expect(message).toContain(`Question ${conflictShownId(1)}`);
    expect(message).toContain('Answer: atrioventricular');
    expect(message).toContain('Answer: The mitral valve');
    expect(message).toContain('This is the passage that supports the answer:');
    for (const secret of [
      'EXPLANATION-SENTINEL-7731',
      'NOTE-SENTINEL-4412',
      'AV-ALIAS-SENTINEL',
      'rv-rune',
      'rv-seance',
      'rv-c1',
    ]) {
      expect(message).not.toContain(secret);
    }
    expect(message).not.toContain('The tricuspid valve');
  });

  it('reply schema is representable and strict', () => {
    expect(toModelJsonSchema(ConflictResponseSchema).ok).toBe(true);
    const good = { results: [{ questionId: 'q1', conflict: false, paragraph: null, quote: null }] };
    expect(ConflictResponseSchema.safeParse(good).success).toBe(true);
    expect(ConflictResponseSchema.safeParse({ results: [{ questionId: 'q1', conflict: true }] }).success).toBe(false);
    expect(ConflictResponseSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
  });

  it('every Phase 6 prompt string passes the banned-phrase scan', () => {
    const bad = ConflictResponseSchema.safeParse({});
    const note = bad.success ? '' : buildRetryNote(bad.error as z.ZodError);
    for (const s of [
      CONFLICT_CHECK_SYSTEM_PROMPT,
      buildConflictUserMessage(questions, heart),
      note,
    ]) {
      expect(findBanned(s), s).toEqual([]);
    }
  });
});
