import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES, MAX_SELECTED_PAGES, capPageSelection, checkFileSize } from './limits';

describe('Property 3: File size and page selection limits', () => {
  // **Validates: Requirements 3.2, 3.3**
  it('fails exactly when the size exceeds the maximum', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_FILE_SIZE_BYTES * 2 }), (bytes) => {
        const result = checkFileSize(bytes);
        expect(result.ok).toBe(bytes <= MAX_FILE_SIZE_BYTES);
        if (!result.ok) {
          expect(result.error).toEqual({ kind: 'file-size', limitBytes: MAX_FILE_SIZE_BYTES });
        }
      }),
    );
    expect(checkFileSize(MAX_FILE_SIZE_BYTES).ok).toBe(true);
    expect(checkFileSize(MAX_FILE_SIZE_BYTES + 1).ok).toBe(false);
  });

  it('keeps the first entries, flags capping only when longer, never exceeds the maximum', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 40 }), (pages) => {
        const { kept, capped } = capPageSelection(pages);
        expect(kept.length).toBeLessThanOrEqual(MAX_SELECTED_PAGES);
        expect(kept).toEqual(pages.slice(0, MAX_SELECTED_PAGES));
        expect(capped).toBe(pages.length > MAX_SELECTED_PAGES);
      }),
    );
  });
});
