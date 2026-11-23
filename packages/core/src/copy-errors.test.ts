import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ERROR_COPY, errorMessage } from './copy';
import {
  MAX_EXTRACTED_WORDS,
  MAX_EXTRACTION_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_PAGES,
} from './limits';
import type { IngestError } from './types';

const ingestErrors: fc.Arbitrary<IngestError> = fc.oneof(
  fc.constant<IngestError>({ kind: 'file-size', limitBytes: MAX_FILE_SIZE_BYTES }),
  fc.constant<IngestError>({ kind: 'page-count', limit: MAX_SELECTED_PAGES }),
  fc.constant<IngestError>({ kind: 'word-count', limit: MAX_EXTRACTED_WORDS }),
  fc.constant<IngestError>({ kind: 'time', limitMs: MAX_EXTRACTION_MS }),
  fc.constant<IngestError>({ kind: 'encrypted' }),
  fc.constant<IngestError>({ kind: 'unreadable' }),
  fc.constant<IngestError>({ kind: 'empty' }),
  fc.constant<IngestError>({ kind: 'storage-unavailable' }),
);

function limitText(error: IngestError): string | null {
  switch (error.kind) {
    case 'file-size':
      return String(error.limitBytes / (1024 * 1024));
    case 'page-count':
      return String(error.limit);
    case 'word-count':
      return error.limit.toLocaleString('en-US');
    case 'time':
      return String(error.limitMs / 1000);
    default:
      return null;
  }
}

describe('Property 5: Problem messages name the limit and a next step', () => {
  // **Validates: Requirements 3.6, 4.4, 11.3, 11.4**
  it('has a what part, a next step, the limit value, and says "your notes"', () => {
    fc.assert(
      fc.property(ingestErrors, (error) => {
        const message = errorMessage(error);
        const copy = ERROR_COPY[error.kind];

        expect(message.trim().length).toBeGreaterThan(0);
        expect(copy.what.trim().length).toBeGreaterThan(0);
        expect(copy.next.trim().length).toBeGreaterThan(0);
        expect(message).toContain(copy.what);
        expect(message).toContain(copy.next);

        const limit = limitText(error);
        if (limit !== null) expect(message).toContain(limit);

        expect(message.toLowerCase()).not.toContain('the source document');
      }),
    );
  });

  it('refers to "your notes" in the messages that mention the notes', () => {
    expect(errorMessage({ kind: 'word-count', limit: MAX_EXTRACTED_WORDS })).toMatch(
      /your notes/i,
    );
    expect(errorMessage({ kind: 'empty' })).toMatch(/your notes/i);
    expect(errorMessage({ kind: 'storage-unavailable' })).toMatch(/your notes/i);
  });
});
