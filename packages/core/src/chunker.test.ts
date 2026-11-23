import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { MIN_CHUNK_CHARS } from './chunker-merge';
import { MAX_CHUNK_CHARS, isHyphenBreak, splitToLimit } from './chunker-split';

const pasteInput = (text: string) => ({ sourceType: 'paste' as const, text, originalText: text });
const pdfPage = (pdfPageIndex: number, text: string) => ({
  pdfPageIndex,
  printedPageLabel: null,
  text,
  originalText: text,
});

function expectBounds(texts: string[]): void {
  for (const t of texts) {
    expect(t.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS);
    expect(t.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  }
}

// **Validates: Requirements 6.10, 6.14, 6.15, 6.16**
describe('chunker constants', () => {
  it('uses 1,200 as max and 40 as min', () => {
    expect(MAX_CHUNK_CHARS).toBe(1200);
    expect(MIN_CHUNK_CHARS).toBe(40);
  });
});

describe('chunker edge cases', () => {
  it('keeps a lone heading under 40 characters as the only chunk on its page', () => {
    const chunks = chunkDocument({
      sourceType: 'pdf',
      pages: [pdfPage(0, 'CHAPTER ONE'), pdfPage(1, 'A normal page of body text that is long enough to stand alone.')],
    });
    const onPageZero = chunks.filter((c) => c.location.sourceType === 'pdf' && c.location.pdfPageIndex === 0);
    expect(onPageZero).toHaveLength(1);
    expect(onPageZero[0]?.text).toBe('CHAPTER ONE');
    expect(onPageZero[0]?.text.length).toBeLessThan(MIN_CHUNK_CHARS);
  });

  it('merges a short last chunk backward into the preceding chunk', () => {
    const body = 'This paragraph is comfortably longer than the forty character minimum.';
    const chunks = chunkDocument({
      sourceType: 'pdf',
      pages: [pdfPage(0, `${body}\n\nTail end.`)],
    });
    expect(chunks).toHaveLength(1);
    // The merge keeps the original blank line: chunk text is a slice of the page.
    expect(chunks[0]?.text).toBe(`${body}\n\nTail end.`);
  });

  it('splits a single sentence over 1,200 characters into bounded chunks', () => {
    const sentence = `${'lorem ipsum dolor '.repeat(100).trim()}.`;
    expect(sentence.length).toBeGreaterThan(MAX_CHUNK_CHARS);
    const chunks = chunkDocument(pasteInput(sentence));
    expect(chunks.length).toBeGreaterThan(1);
    expectBounds(chunks.map((c) => c.text));
    expect(chunks.map((c) => c.text).join(' ')).toBe(sentence);
  });
});

describe('merge-step rebalance regressions', () => {
  it('rebalances a ~2,400 character sentence whose naive split leaves a tail under 40', () => {
    const fillers = ['qu', 'zib', 'mela', 'ro', 'dun', 'fex', 'sol', 'tav'];
    const ending = 'ref ale zag dcammcal.';
    let text = '';
    let naiveTail = -1;
    for (let n = 300; n < 900 && naiveTail < 0; n++) {
      const words = Array.from({ length: n }, (_, i) => fillers[i % fillers.length] as string);
      const candidate = `${words.join(' ')} ${ending}`;
      if (candidate.length < 2350 || candidate.length > 2450) continue;
      const pieces = splitToLimit(candidate, MAX_CHUNK_CHARS);
      const last = pieces[pieces.length - 1] as string;
      if (pieces.length === 3 && last.length < MIN_CHUNK_CHARS) {
        text = candidate;
        naiveTail = last.length;
      }
    }
    expect(naiveTail).toBeGreaterThan(0);
    expect(naiveTail).toBeLessThan(MIN_CHUNK_CHARS);
    expect(text.endsWith(ending)).toBe(true);

    const chunks = chunkDocument(pasteInput(text));
    expect(chunks.length).toBeGreaterThan(1);
    expectBounds(chunks.map((c) => c.text));
    expect(chunks[chunks.length - 1]?.text.endsWith(ending)).toBe(true);
  });

  it('rebalances a long token with no whitespace using the hard-cut fallback', () => {
    const token = Array.from({ length: 2410 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    const naive = splitToLimit(token, MAX_CHUNK_CHARS);
    expect((naive[naive.length - 1] as string).length).toBeLessThan(MIN_CHUNK_CHARS);

    const chunks = chunkDocument(pasteInput(token));
    expect(chunks.length).toBeGreaterThan(1);
    expectBounds(chunks.map((c) => c.text));
    expect(chunks.map((c) => c.text).join('')).toBe(token);
  });
});

describe('offset-based rebalance keeps original whitespace', () => {
  it('keeps a line-break hyphen inside the rebalance window', () => {
    // Build one sentence whose naive word split leaves a tail under 40 that
    // starts with "exam-\nple" (the split never cuts at the hyphen's newline),
    // forcing a rebalance whose window spans the hyphen break.
    let prefix = '';
    const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'nisi'];
    for (let i = 0; prefix.length < MAX_CHUNK_CHARS - 'exam-'.length - 6; i++) {
      prefix += `${words[i % words.length] as string} `;
    }
    while (prefix.length < MAX_CHUNK_CHARS - 'exam-'.length) prefix = `x${prefix}`;
    const text = `${prefix}exam-\nple ends here.`;
    expect(text.indexOf('\n')).toBe(MAX_CHUNK_CHARS);

    const naive = splitToLimit(text, MAX_CHUNK_CHARS);
    expect(naive).toHaveLength(2);
    expect(naive[1]?.startsWith('exam-\nple')).toBe(true);
    expect((naive[1] as string).length).toBeLessThan(MIN_CHUNK_CHARS);

    const chunks = chunkDocument(pasteInput(text));
    expect(chunks.length).toBeGreaterThan(1);
    expectBounds(chunks.map((c) => c.text));
    for (const chunk of chunks) {
      // Until the Quote Resolver exists (task 5.2): every chunk is an exact
      // substring of the source, so normalisation can de-hyphenate it later.
      expect(text.includes(chunk.text)).toBe(true);
      expect(chunk.text).not.toContain('exam- ple');
    }
    expect(chunks.filter((c) => c.text.includes('exam-\nple'))).toHaveLength(1);
  });

  it('keeps repeated text intact when pieces repeat', () => {
    const sentence = 'The same sentence repeats here. ';
    const text = `${sentence.repeat(40)}Tail.`;
    const chunks = chunkDocument(pasteInput(text));
    expectBounds(chunks.map((c) => c.text));
    let cursor = 0;
    for (const chunk of chunks) {
      const at = text.indexOf(chunk.text, cursor);
      expect(at).toBeGreaterThanOrEqual(cursor);
      expect(text.slice(cursor, at).trim()).toBe('');
      cursor = at + chunk.text.length;
    }
    expect(text.slice(cursor).trim()).toBe('');
  });
});

/** Words joined by single spaces, padded to exactly `length` with a trailing space. */
function wordsOfLength(length: number): string {
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'nisi'];
  let out = '';
  for (let i = 0; out.length < length - 8; i++) out += `${words[i % words.length] as string} `;
  while (out.length < length) out = `x${out}`;
  return out;
}

describe('line-break hyphens are not word boundaries', () => {
  it.each([
    ['a newline', '\n'],
    ['spaces around the newline', ' \n '],
    ['a newline then spaces', '\n  '],
  ])('keeps "exam-" and "ple" together when the natural cut lands on %s', (_name, gap) => {
    // "exam-" ends at index 1199, so the last whitespace at or before the
    // 1,200 limit is the start of the hyphen gap: the natural cut.
    const prefix = wordsOfLength(MAX_CHUNK_CHARS - 'exam-'.length);
    const text = `${prefix}exam-${gap}ple ${'and the sentence carries on '.repeat(4)}to the end.`;
    expect(/\s/.test(text.charAt(MAX_CHUNK_CHARS))).toBe(true);
    expect(text.length).toBeLessThan(2 * MAX_CHUNK_CHARS);

    const pieces = splitToLimit(text, MAX_CHUNK_CHARS);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.endsWith('exam-')).toBe(false);
    expect(pieces[1]?.startsWith(`exam-${gap}ple`)).toBe(true);

    const chunks = chunkDocument(pasteInput(text));
    expectBounds(chunks.map((c) => c.text));
    expect(chunks.filter((c) => c.text.includes(`exam-${gap}ple`))).toHaveLength(1);
    for (const chunk of chunks) {
      expect(chunk.text.endsWith('-')).toBe(false);
      expect(text.includes(chunk.text)).toBe(true);
    }
  });

  it('still cuts at a hyphen break, before any hard cut, when it is the only whitespace in reach', () => {
    const head = `${'a'.repeat(1190)}-`;
    const text = `${head}\n${'p'.repeat(20)} ${'and the sentence carries on '.repeat(3)}to the end.`;
    const chunks = chunkDocument(pasteInput(text));
    expectBounds(chunks.map((c) => c.text));
    // The cut lands on the hyphen's newline, not inside the run of "a".
    expect(chunks[0]?.text).toBe(head);
  });

  it('recognises only whitespace runs with a newline between "-" and a letter', () => {
    const at = (s: string): boolean => isHyphenBreak(s, s.indexOf('-') + 1);
    expect(at('exam-\nple')).toBe(true);
    expect(at('exam- \n ple')).toBe(true);
    expect(at('exam-\n\u00e9tude')).toBe(true);
    expect(at('exam- ple')).toBe(false);
    expect(at('exam-\n2024')).toBe(false);
    expect(at('exam-\n"ple"')).toBe(false);
    expect(isHyphenBreak('exam\nple', 4)).toBe(false);
    expect(isHyphenBreak('exam-ple', 4)).toBe(false);
  });
});