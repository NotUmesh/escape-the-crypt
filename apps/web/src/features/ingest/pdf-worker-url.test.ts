import { describe, expect, it } from 'vitest';
import { pdfWorkerUrl } from './pdf-worker-url';

describe('pdfWorkerUrl', () => {
  it('serves from the root', () => {
    expect(pdfWorkerUrl('/', 'https://example.test')).toBe('https://example.test/pdf.worker.min.mjs');
  });
  it('keeps a subpath base', () => {
    expect(pdfWorkerUrl('/crypt/', 'https://example.test')).toBe(
      'https://example.test/crypt/pdf.worker.min.mjs',
    );
  });
  it('adds a missing trailing slash', () => {
    expect(pdfWorkerUrl('/crypt', 'https://example.test')).toBe(
      'https://example.test/crypt/pdf.worker.min.mjs',
    );
  });
});
