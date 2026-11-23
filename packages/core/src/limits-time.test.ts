import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_EXTRACTED_WORDS,
  MAX_EXTRACTION_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_PAGES,
  checkElapsed,
} from './limits';

describe('Property 4: Elapsed-time limit with injected clock', () => {
  // **Validates: Requirements 3.5, 14.1**
  it('passes when the difference is at most the maximum and fails when greater', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: MAX_EXTRACTION_MS * 3 }),
        (start, elapsed) => {
          const result = checkElapsed(start, start + elapsed);
          if (elapsed <= MAX_EXTRACTION_MS) {
            expect(result.ok).toBe(true);
          } else {
            expect(result).toEqual({
              ok: false,
              error: { kind: 'time', limitMs: MAX_EXTRACTION_MS },
            });
          }
        },
      ),
    );
  });

  it('treats exactly 20000 ms as passing and 20001 ms as failing', () => {
    expect(checkElapsed(5, 5 + 20_000).ok).toBe(true);
    expect(checkElapsed(5, 5 + 20_001).ok).toBe(false);
  });
});

describe('Named limit constants', () => {
  // **Validates: Requirements 3.1**
  it('have the specified values', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_SELECTED_PAGES).toBe(10);
    expect(MAX_EXTRACTED_WORDS).toBe(6000);
    expect(MAX_EXTRACTION_MS).toBe(20000);
  });
});
