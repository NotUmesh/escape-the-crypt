import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('self-hosted pdf.js worker file', () => {
  it('matches the installed pdfjs-dist version', () => {
    const installed = (JSON.parse(read('../../../node_modules/pdfjs-dist/package.json')) as {
      version: string;
    }).version;
    // The version is stamped in the licence header at the top of the bundle.
    const header = read('../../../public/pdf.worker.min.mjs').slice(0, 4096);
    const stamped = /pdfjsVersion = (\S+)/u.exec(header)?.[1];
    expect(stamped, 'no pdfjsVersion stamp in the worker file header').toBeDefined();
    expect(stamped, 'copy node_modules/pdfjs-dist/build/pdf.worker.min.mjs into apps/web/public').toBe(
      installed,
    );
  });
});
