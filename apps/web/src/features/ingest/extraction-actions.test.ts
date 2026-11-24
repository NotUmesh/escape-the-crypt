import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runExtraction } from './extraction-core';
import type { ExtractionMessageOut, PdfDocumentLike } from './extraction-core';
import { safeDocumentParams } from './extraction-options';

type PdfJs = typeof import('pdfjs-dist');

afterEach(() => vi.unstubAllGlobals());

describe('pdf.js options (2.5)', () => {
  const params = safeDocumentParams(new ArrayBuffer(8));

  it('turns scripting off', () => {
    expect(params.enableScripting).toBe(false);
  });

  it('sets no password and no cross-origin fetching', () => {
    expect(params.password).toBeUndefined();
    expect(params.useWorkerFetch).toBe(false);
    expect(params.useSystemFonts).toBe(false);
    expect(params.cMapUrl).toBeUndefined();
    expect(params.standardFontDataUrl).toBeUndefined();
  });

  it('opens the bytes it is given and nothing else', () => {
    expect(Object.keys(params).sort()).toEqual(['data', 'enableScripting', 'useSystemFonts', 'useWorkerFetch']);
    expect(params.data).toBeInstanceOf(Uint8Array);
  });
});

describe('a PDF with embedded JavaScript (2.5)', () => {
  it('is read as text and its script causes no side effect', async () => {
    const alert = vi.fn();
    const open = vi.fn();
    vi.stubGlobal('alert', alert);
    vi.stubGlobal('open', open);
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    const bytes = await readFile(join(import.meta.dirname, 'fixtures', 'embedded-javascript.pdf'));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const task = pdfjs.getDocument(safeDocumentParams(buffer));
    try {
      const doc = await task.promise;
      // The password callback is never set.
      expect(task.onPassword).toBeFalsy();
      // The fixture really holds a script, so "no side effect" is not just "no script".
      expect(await doc.hasJSActions()).toBe(true);
      expect(JSON.stringify([...((await doc.getJSActions()) ?? [])])).toContain('app.alert');

      const out: ExtractionMessageOut[] = [];
      await runExtraction({
        doc: doc as unknown as PdfDocumentLike,
        pageIndexes: [0],
        startedAtMs: 0,
        clock: { now: () => 0 },
        post: (m) => out.push(m),
        isCancelled: () => false,
      });
      expect(out.map((m) => m.type)).toEqual(['progress', 'page', 'done']);
      expect(out.find((m) => m.type === 'page')).toMatchObject({ flag: 'ok' });
      expect(alert).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally {
      await task.destroy();
    }
  });
});