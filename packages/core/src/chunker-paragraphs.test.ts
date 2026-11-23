import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { pastedTextArb } from './test-support/arbitraries';

const BLANK_RUN = /\n[^\S\n]*\n/;
const stripWs = (s: string): string => s.replace(/\s+/g, '');

describe('Property 1: Paste paragraphs split at blank lines', () => {
  // **Validates: Requirements 1.2, 6.1**
  it('numbers paragraphs consecutively, has no blank-line runs, and keeps all characters in order', () => {
    fc.assert(
      fc.property(pastedTextArb, (text) => {
        const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
        const expectedParagraphs = text.split(/\n[^\S\n]*(?:\n[^\S\n]*)+/).filter((p) => p.trim()).length;

        const numbers: number[] = [];
        for (const chunk of chunks) {
          expect(chunk.text.trim().length).toBeGreaterThan(0);
          expect(BLANK_RUN.test(chunk.text)).toBe(false);
          expect(chunk.location.sourceType).toBe('paste');
          if (chunk.location.sourceType === 'paste') numbers.push(chunk.location.paragraphNumber);
        }

        // Numbers are non-decreasing, start at 1 and cover 1..N with no gaps.
        const distinct = [...new Set(numbers)];
        expect(distinct).toEqual(Array.from({ length: expectedParagraphs }, (_, i) => i + 1));
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));

        // Joining with a blank line preserves non-whitespace characters in order.
        expect(stripWs(chunks.map((c) => c.text).join('\n\n'))).toBe(stripWs(text));
      }),
    );
  });
});
