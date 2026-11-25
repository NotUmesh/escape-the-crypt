import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES } from '../copy';
import type { Chunk } from '../types';
import { checkBannedPhrase, checkNegativeQuestion, checkQuote, MAX_QUOTE_WORDS } from './evidence';

const QID = 'q1';
const CHUNK_ID = 'chk_abcdef123456_0';

const words = (n: number): string[] => Array.from({ length: n }, (_, i) => `word${i + 1}x`);

function makeChunk(text: string, id = CHUNK_ID): Chunk {
  return {
    id,
    documentDigest: 'a'.repeat(64),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
}

const passage = words(30).join(' ');
const chunks = new Map<string, Chunk>([[CHUNK_ID, makeChunk(passage)]]);
const ref = (quote: string, paragraphChunkId = CHUNK_ID) => ({ paragraphChunkId, quote });

describe('checkQuote', () => {
  it('fails a 26-word resolvable quote with exactly quote-too-long', () => {
    const quote = words(MAX_QUOTE_WORDS + 1).join(' ');
    expect(checkQuote(chunks, ref(quote), QID)).toEqual({
      checkId: 'quote-too-long',
      questionId: QID,
    });
  });

  it('accepts a 25-word resolvable quote', () => {
    const quote = words(MAX_QUOTE_WORDS).join(' ');
    expect(checkQuote(chunks, ref(quote), QID)).toBeNull();
  });

  it('maps not-found', () => {
    expect(checkQuote(chunks, ref('entirely absent from the passage text'), QID)).toEqual({
      checkId: 'quote-not-found',
      questionId: QID,
    });
  });

  it('maps ambiguous', () => {
    const repeated = new Map([[CHUNK_ID, makeChunk('alpha beta gamma delta. alpha beta gamma delta.')]]);
    expect(checkQuote(repeated, ref('alpha beta gamma delta'), QID)).toEqual({
      checkId: 'quote-ambiguous',
      questionId: QID,
    });
  });

  it('maps too-short', () => {
    expect(checkQuote(chunks, ref('word1x word2x'), QID)).toEqual({
      checkId: 'quote-too-short',
      questionId: QID,
    });
  });

  it('maps unknown-chunk', () => {
    const quote = words(6).join(' ');
    expect(checkQuote(chunks, ref(quote, 'chk_missing_9'), QID)).toEqual({
      checkId: 'unknown-paragraph/chunk',
      questionId: QID,
    });
  });
});

describe('checkBannedPhrase', () => {
  it.each(BANNED_COPY_PHRASES.map((p) => [p]))('flags banned phrase %s', (phrase) => {
    expect(checkBannedPhrase(['A clean prompt', `Contains ${phrase.toUpperCase()} here`], QID)).toEqual({
      checkId: 'banned-phrase',
      questionId: QID,
    });
  });

  it('passes clean text', () => {
    expect(checkBannedPhrase(['According to your notes, what is a cell?', 'A unit'], QID)).toBeNull();
  });
});

describe('checkNegativeQuestion', () => {
  it.each(['not', 'never', 'except', 'incorrect', 'false', "isn't", "aren't", "doesn't"])(
    'flags negation marker %s',
    (marker) => {
      expect(
        checkNegativeQuestion(`According to your notes, which statement is ${marker} listed?`, QID),
      ).toEqual({ checkId: 'negative-question', questionId: QID });
    },
  );

  it('passes a positive prompt', () => {
    expect(checkNegativeQuestion('According to your notes, what does the nucleus hold?', QID)).toBeNull();
  });

  it('does not match negation words inside other words', () => {
    expect(checkNegativeQuestion('According to your notes, what is a knot?', QID)).toBeNull();
  });

  it('exempts a cursed-object "which one ... not" prompt', () => {
    expect(
      checkNegativeQuestion('Which one of these is not a mammal?', QID, 'cursed-object'),
    ).toBeNull();
  });

  it('does not exempt the same prompt for other lock types', () => {
    expect(checkNegativeQuestion('Which one of these is not a mammal?', QID, 'seance-board')).toEqual({
      checkId: 'negative-question',
      questionId: QID,
    });
  });

  it('does not exempt other negations on cursed-object prompts', () => {
    expect(
      checkNegativeQuestion('Which item never belongs with the others?', QID, 'cursed-object'),
    ).toEqual({ checkId: 'negative-question', questionId: QID });
  });
});
