import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker';
import { isHeadingOnlyChunk } from './chunker-heading';
import { candidateSpans, isAllCapsHeading, spanText } from './chunker-split';

// Task 14.6: isHeadingOnlyChunk must agree with what the splitter treats as a heading.
// Only eval/dev notes and samples/*.txt are read. The holdout set is never touched.

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as {
  readdirSync(path: string): string[];
  readFileSync(path: string, enc: string): string;
};
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const repoRoot = `${here}/../../..`;

// Same regex as the private PARAGRAPH_BREAK in chunker.ts.
const PARAGRAPH_BREAK = /\n[^\S\n]*(?:\n[^\S\n]*)+/;
const paragraphsOf = (text: string): string[] =>
  text
    .split(PARAGRAPH_BREAK)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

function noteFiles(): string[] {
  const devNotes = [repoRoot, 'eval', 'dev', 'notes'].join('/');
  const samples = [repoRoot, 'samples'].join('/');
  const out: string[] = [];
  for (const [dir, ext] of [
    [devNotes, '.txt'],
    [samples, '.txt'],
  ] as const) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(ext)) out.push(`${dir}/${name}`);
    }
  }
  return out;
}

interface Disagreement {
  readonly source: string;
  readonly chunkText: string;
  readonly heading: boolean;
  readonly oracle: boolean;
}

interface Scan {
  chunks: number;
  headings: number;
  disagreements: Disagreement[];
}

function scan(source: string, text: string, into: Scan): void {
  const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
  const paragraphs = paragraphsOf(text);
  const highest = chunks.reduce(
    (max, c) => (c.location.sourceType === 'paste' ? Math.max(max, c.location.paragraphNumber) : max),
    0,
  );
  expect(highest, `${source}: paragraph count`).toBeLessThanOrEqual(paragraphs.length);
  for (const chunk of chunks) {
    if (chunk.location.sourceType !== 'paste') throw new Error('expected paste location');
    const paragraph = paragraphs[chunk.location.paragraphNumber - 1];
    expect(paragraph, `${source}: paragraph ${chunk.location.paragraphNumber}`).toBeDefined();
    const oracle = candidateSpans(paragraph ?? '').some((span) => {
      const spanned = spanText(paragraph ?? '', span);
      return spanned === chunk.text && !/[\n\r]/.test(spanned) && isAllCapsHeading(spanned);
    });
    const heading = isHeadingOnlyChunk(chunk);
    into.chunks++;
    if (heading) into.headings++;
    if (heading !== oracle) {
      into.disagreements.push({ source, chunkText: chunk.text, heading, oracle });
    }
  }
}

describe('isHeadingOnlyChunk agrees with candidateSpans (task 14.6)', () => {
  const files = noteFiles();
  const result: Scan = { chunks: 0, headings: 0, disagreements: [] };
  let paragraphCountOk = true;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    scan(file.slice(repoRoot.length + 1), text, result);
    const chunks = chunkDocument({ sourceType: 'paste', text, originalText: text });
    const highest = chunks.reduce(
      (max, c) => (c.location.sourceType === 'paste' ? Math.max(max, c.location.paragraphNumber) : max),
      0,
    );
    if (highest !== paragraphsOf(text).length) paragraphCountOk = false;
  }

  it('scans a non-trivial number of files and chunks', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(result.chunks).toBeGreaterThanOrEqual(50);
  });

  it('recovers paragraphs the same way the chunker numbers them', () => {
    expect(paragraphCountOk).toBe(true);
  });

  it('agrees on every real notes chunk', () => {
    expect(result.disagreements).toEqual([]);
  });

  it('agrees on synthetic notes with an all-caps heading (true branch)', () => {
    const synthetic = [
      'THE WATER CYCLE',
      '',
      'Water evaporates from the ocean surface and rises as vapor into the cooler air above it.',
      'It condenses into clouds, and later falls as rain or snow.',
      '',
      'Runoff returns the water to rivers and the sea, where the cycle begins again.',
    ].join('\n');
    const synth: Scan = { chunks: 0, headings: 0, disagreements: [] };
    scan('synthetic', synthetic, synth);
    expect(synth.headings).toBeGreaterThanOrEqual(1);
    expect(synth.disagreements).toEqual([]);
  });
});
