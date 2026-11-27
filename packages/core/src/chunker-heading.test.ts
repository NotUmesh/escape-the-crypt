import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { isHeadingOnlyChunk } from './chunker-heading';
import { resolveQuote } from './quote-resolver';
import type { Chunk } from './types';

const heading = (text: string): boolean => isHeadingOnlyChunk({ text });

// packages/core compiles without Node types, so load Node modules dynamically.
async function readHumanHeart(): Promise<string> {
  const fsSpecifier: string = 'node:fs';
  const urlSpecifier: string = 'node:url';
  const fs = (await import(fsSpecifier)) as unknown as {
    readFileSync(path: string, enc: string): string;
  };
  const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
  const href = (import.meta as unknown as { url: string }).url;
  const here = url.fileURLToPath(href).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  return fs.readFileSync(`${here}/../../../samples/human-heart.txt`, 'utf8');
}

describe('isHeadingOnlyChunk', () => {
  it('is true for a single all-caps line', () => {
    expect(heading('THE HUMAN HEART')).toBe(true);
  });

  it('accepts an 80-character all-caps line and rejects an 81-character one', () => {
    expect(heading('A'.repeat(80))).toBe(true);
    expect(heading('A'.repeat(81))).toBe(false);
  });

  it('is false for mixed-case "The human heart"', () => {
    expect(heading('The human heart')).toBe(false);
  });

  it('is false for a short non-heading sentence', () => {
    expect(heading('It sits in the chest.')).toBe(false);
  });

  it('is false for an all-caps line with terminal punctuation', () => {
    expect(heading('THE HEART PUMPS.')).toBe(false);
    expect(heading('CHAMBERS:')).toBe(false);
  });

  it('is false for a multi-line all-caps chunk', () => {
    expect(heading('HEART\nVALVES')).toBe(false);
  });

  it('is false for a normal paragraph', () => {
    expect(
      heading('The heart has four chambers. The two upper chambers are the right atrium and the left atrium.'),
    ).toBe(false);
  });

  it('is false for a short heading that mergeShort merged into the following body text', () => {
    const body = 'The heart has four chambers. The two upper chambers are the right atrium and the left atrium.';
    const chunks = chunkDocument({ sourceType: 'paste', text: `HEART\n${body}`, originalText: `HEART\n${body}` });
    expect(chunks).toHaveLength(1);
    const text = chunks[0]!.text;
    expect(text).toBe(`HEART\n${body}`);
    expect(/\n/.test(text)).toBe(true);
    expect(heading(text)).toBe(false);
  });

  it('keeps a quote from the mixed-case human-heart paragraph 1 quotable but too short', async () => {
    const notes = await readHumanHeart();
    const chunks = chunkDocument({ sourceType: 'paste', text: notes, originalText: notes });
    const first = chunks[0] as Chunk;
    expect(first.location).toEqual({ sourceType: 'paste', paragraphNumber: 1 });
    expect(first.text).toBe('The human heart');
    expect(heading(first.text)).toBe(false);

    const map = new Map(chunks.map((c) => [c.id, c]));
    const result = resolveQuote(map, first.id, 'The human heart');
    expect(result).toEqual({ ok: false, error: { kind: 'too-short' } });
  });
});
