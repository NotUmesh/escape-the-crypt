import { describe, expect, it } from 'vitest';
import { normaliseWithMap } from './normalise';
import { MIN_QUOTE_CHARS, MIN_QUOTE_WORDS, resolveQuote } from './quote-resolver';
import type { Chunk } from './types';

function makeChunk(text: string): Chunk {
  return {
    id: 'chk_abcdef123456_0',
    documentDigest: 'abcdef123456'.padEnd(64, '0'),
    position: 0,
    text,
    location: { sourceType: 'paste', paragraphNumber: 1 },
    edited: false,
  };
}

function resolve(text: string, quote: string, chunkId?: string) {
  const chunk = makeChunk(text);
  return resolveQuote(new Map([[chunk.id, chunk]]), chunkId ?? chunk.id, quote);
}

describe('quote resolver: unknown chunk and ordering (7.11, 7.12)', () => {
  const text = 'The quick brown fox jumps over the lazy dog.';

  it('returns unknown-chunk for an unknown chunk ID with a valid quote', () => {
    expect(resolve(text, 'quick brown fox jumps over', 'nope')).toEqual({
      ok: false,
      error: { kind: 'unknown-chunk' },
    });
  });

  it('returns too-short, not unknown-chunk, when both apply', () => {
    expect(resolve(text, 'quick brown', 'nope')).toEqual({
      ok: false,
      error: { kind: 'too-short' },
    });
  });
});

describe('quote resolver: line-break hyphen trade-off (7.2)', () => {
  const text = 'The old well-\nknown scholar wrote many books today.';

  it('resolves a quote written without the hyphen ("wellknown")', () => {
    const result = resolve(text, 'old wellknown scholar wrote many');
    expect(result.ok).toBe(true);
  });

  it('resolves a quote that spans the line-break hyphen as written', () => {
    const result = resolve(text, 'old well-\nknown scholar wrote many');
    expect(result.ok).toBe(true);
  });

  it('does not resolve "well-known" typed on one line', () => {
    expect(resolve(text, 'old well-known scholar wrote many')).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
  });
});

describe('normalisation: line-break hyphen before a digit is kept (7.2)', () => {
  const text = 'Read pages 5-\n10 of your notes before the next session.';

  it('keeps the hyphen and turns the line break into a space', () => {
    expect(normaliseWithMap('pages 5-\n10').text).toBe('pages 5- 10');
    expect(normaliseWithMap('pages 5- \n 10').text).toBe('pages 5- 10');
    expect(normaliseWithMap('exam-\nple').text).toBe('example');
  });

  it('maps every kept character back to the original text', () => {
    const { text: norm, originalRange } = normaliseWithMap('pages 5-\n10');
    const hyphen = norm.indexOf('-');
    expect(originalRange[hyphen]).toEqual([7, 8]);
    expect(originalRange[hyphen + 1]).toEqual([8, 9]);
  });

  it('does not resolve the digits joined as "510"', () => {
    expect(resolve(text, 'Read pages 510 of your notes')).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
  });

  it('resolves the range as written, across the line break', () => {
    const result = resolve(text, 'Read pages 5-\n10 of your notes');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(text.slice(result.value.start, result.value.end)).toBe('Read pages 5-\n10 of your notes');
  });
});
describe('quote resolver: minimum size constants (7.7)', () => {
  it('exports 4 words and 20 characters', () => {
    expect(MIN_QUOTE_WORDS).toBe(4);
    expect(MIN_QUOTE_CHARS).toBe(20);
  });

  const text = 'aaaa bbbb cccc ddddd eeee ffff';

  it('rejects 4 words with 19 characters', () => {
    expect('aaaa bbbb cccc dddd'.length).toBe(19);
    expect(resolve('aaaa bbbb cccc dddd eeee', 'aaaa bbbb cccc dddd')).toEqual({
      ok: false,
      error: { kind: 'too-short' },
    });
  });

  it('accepts 4 words with exactly 20 characters', () => {
    expect('aaaa bbbb cccc ddddd'.length).toBe(20);
    expect(resolve(text, 'aaaa bbbb cccc ddddd').ok).toBe(true);
  });

  it('rejects 3 words even when longer than 20 characters', () => {
    expect(resolve('abcdefghij klmnopqrst uvwxyzabcd', 'abcdefghij klmnopqrst uvwxyzabcd')).toEqual({
      ok: false,
      error: { kind: 'too-short' },
    });
  });
});
