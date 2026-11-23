import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_EXTRACTED_WORDS, checkWordCount, countWords } from './limits';

describe('Property 2: Word-count limit boundary', () => {
  // **Validates: Requirements 1.3, 3.4**
  it('passes at or below the maximum and fails above it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_EXTRACTED_WORDS * 2 }), (total) => {
        const result = checkWordCount(total);
        if (total <= MAX_EXTRACTED_WORDS) {
          expect(result.ok).toBe(true);
        } else {
          expect(result).toEqual({
            ok: false,
            error: { kind: 'word-count', limit: MAX_EXTRACTED_WORDS },
          });
        }
      }),
    );
  });

  it('treats the exact boundary as passing and one over as failing', () => {
    expect(checkWordCount(MAX_EXTRACTED_WORDS).ok).toBe(true);
    expect(checkWordCount(MAX_EXTRACTED_WORDS + 1).ok).toBe(false);
  });

  it('counts words in generated text consistently with the check', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.constantFrom(' ', '\n', ' \t '), (n, sep) => {
        const text = Array<string>(n).fill('w').join(sep);
        expect(countWords(text)).toBe(n);
      }),
    );
    expect(countWords('   ')).toBe(0);
  });
});
