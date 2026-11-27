import { describe, expect, it } from 'vitest';
import { runChecks, type CheckableQuestion } from '../checks/run-checks';
import {
  prepareDocument,
  toDocumentChunkMaps,
  toEvidenceContext,
  translateChunkId,
} from './prepare-input';

const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

const BODY_1 =
  'Mitochondria produce most of the energy that a cell uses to stay alive and to grow over time.';
const BODY_2 =
  'Ribosomes build proteins from amino acids, following instructions copied from the genetic material.';
const HEADING = 'CELL ORGANELLES OVERVIEW';
const NOTES = `${BODY_1}\n\n${HEADING}\n\n${BODY_2}`;

describe('prepareDocument', () => {
  it('keeps an all-caps heading out of the quotable chunks and in headingContext', () => {
    const prepared = prepareDocument(NOTES);
    const quotable = [...prepared.quotableChunksByOrdinal.values()].map((c) => c.text);
    expect(quotable).toEqual([BODY_1, BODY_2]);
    expect(quotable).not.toContain(HEADING);
    expect(prepared.headingContext).toEqual([HEADING]);
    expect(prepared.chunks.size).toBe(3);
  });

  it('numbers quotable chunks 1-based and contiguously', () => {
    const prepared = prepareDocument(NOTES);
    expect([...prepared.quotableChunksByOrdinal.keys()]).toEqual([1, 2]);
    expect(prepared.quotableChunksByOrdinal.get(1)?.text).toBe(BODY_1);
    expect(prepared.quotableChunksByOrdinal.get(2)?.text).toBe(BODY_2);
    for (const [ordinal, chunk] of prepared.quotableChunksByOrdinal) {
      expect(prepared.ordinalByChunkId.get(chunk.id)).toBe(ordinal);
    }
  });

  it('treats "The human heart" in samples/human-heart.txt as quotable, not heading context', () => {
    const text = fs.readFileSync(`${here}/../../../../samples/human-heart.txt`, 'utf8');
    const prepared = prepareDocument(text);
    expect(prepared.headingContext).not.toContain('The human heart');
    const quotable = [...prepared.quotableChunksByOrdinal.values()];
    expect(quotable.some((c) => c.text.includes('The human heart'))).toBe(true);
    expect([...prepared.quotableChunksByOrdinal.keys()]).toEqual(
      quotable.map((_, i) => i + 1),
    );
  });

  it('accepts ready chunks and gives the same result as the text', () => {
    const fromText = prepareDocument(NOTES);
    const fromChunks = prepareDocument([...fromText.chunks.values()]);
    expect([...fromChunks.quotableChunksByOrdinal.keys()]).toEqual([1, 2]);
    expect(fromChunks.headingContext).toEqual([HEADING]);
  });
});

describe('translateChunkId', () => {
  it('returns the ordinal of a quotable chunk', () => {
    const prepared = prepareDocument(NOTES);
    const second = prepared.quotableChunksByOrdinal.get(2)!;
    expect(translateChunkId(prepared, second.id)).toEqual({ ok: true, value: 2 });
  });

  it('returns pipeline-unknown-chunk for a heading chunk ID and for an unknown ID', () => {
    const prepared = prepareDocument(NOTES);
    const heading = [...prepared.chunks.values()].find((c) => c.text === HEADING)!;
    expect(translateChunkId(prepared, heading.id)).toEqual({
      ok: false,
      error: { kind: 'pipeline-unknown-chunk', chunkId: heading.id },
    });
    expect(translateChunkId(prepared, 'chk_nope')).toEqual({
      ok: false,
      error: { kind: 'pipeline-unknown-chunk', chunkId: 'chk_nope' },
    });
  });
});

describe('toDocumentChunkMaps and toEvidenceContext', () => {
  it('hold only quotable chunks', () => {
    const prepared = prepareDocument(NOTES);
    const heading = [...prepared.chunks.values()].find((c) => c.text === HEADING)!;
    const maps = toDocumentChunkMaps(prepared);
    expect(maps.chunks.size).toBe(2);
    expect(maps.chunks.has(heading.id)).toBe(false);
    expect([...maps.chunksByParagraph.keys()]).toEqual([1, 2]);
    expect([...maps.chunksByParagraph.values()]).not.toContain(heading.id);

    const context = toEvidenceContext(prepared);
    expect(context.chunks.size).toBe(2);
    expect(context.chunks.has(heading.id)).toBe(false);
    expect([...context.paragraphChunkIds.values()]).not.toContain(heading.id);
  });

  it('fails runChecks with unknown-paragraph/chunk for a rune question citing the heading slot', () => {
    const prepared = prepareDocument(NOTES);
    const context = toEvidenceContext(prepared);
    const headingOrdinal = prepared.quotableChunksByOrdinal.size + 1;
    const question = {
      id: 'q',
      conceptId: 'c',
      role: 'primary',
      lockType: 'rune-cipher',
      prompt: 'According to your notes, the ______ produce most of the energy.',
      answer: 'Mitochondria',
      aliases: [],
      caseSensitive: false,
      evidence: [{ paragraph: headingOrdinal, quote: 'Mitochondria produce most of the energy that a cell uses' }],
      explanation: '-',
    } as CheckableQuestion;
    const ids = runChecks({ ...context, question }).map((f) => f.checkId);
    expect(ids).toContain('unknown-paragraph/chunk');
  });
});
