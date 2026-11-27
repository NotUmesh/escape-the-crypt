import { MIN_CHUNK_CHARS, mergeShort } from './chunker-merge';
import { splitBalanced } from './chunker-rebalance';
import { MAX_CHUNK_CHARS, candidateSpans, spanText } from './chunker-split';
import { documentDigest } from './digest';
import { reflowLineBreaks } from './reflow';
import type { Chunk, SourceLocation } from './types';

export interface PdfPageInput {
  readonly pdfPageIndex: number;
  readonly printedPageLabel: string | null;
  /** Confirmed (possibly edited) text. */
  readonly text: string;
  /** Original extraction text, used for the edited flag. */
  readonly originalText: string;
}

export type ChunkInput =
  | { sourceType: 'paste'; text: string; originalText: string }
  | { sourceType: 'pdf'; pages: readonly PdfPageInput[] };

interface Unit {
  text: string;
  originalText: string;
  location: SourceLocation;
}

const PARAGRAPH_BREAK = /\n[^\S\n]*(?:\n[^\S\n]*)+/;

function splitParagraphs(text: string): string[] {
  return text
    .split(PARAGRAPH_BREAK)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Units hold reflowed text (see reflow.ts): hard line wraps and line-break hyphens are repaired
 * here, once, so a chunk's text is both what the model reads and what quotes resolve against.
 */
function buildUnits(input: ChunkInput): Unit[] {
  if (input.sourceType === 'paste') {
    const original = splitParagraphs(reflowLineBreaks(input.originalText));
    return splitParagraphs(reflowLineBreaks(input.text)).map((text, index) => ({
      text,
      originalText: original[index] ?? '',
      location: { sourceType: 'paste', paragraphNumber: index + 1 },
    }));
  }
  return input.pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => ({
      text: reflowLineBreaks(page.text),
      originalText: reflowLineBreaks(page.originalText),
      location: {
        sourceType: 'pdf',
        pdfPageIndex: page.pdfPageIndex,
        printedPageLabel: page.printedPageLabel,
      },
    }));
}

/**
 * Chunk texts of one unit. Every step works on [start, end) offsets into the
 * unit text, and each chunk is a trimmed slice of it. The unit text is already reflowed.
 */
function chunkUnitText(text: string): string[] {
  const pieces = candidateSpans(text).flatMap((candidate) =>
    splitBalanced(text, candidate, MIN_CHUNK_CHARS, MAX_CHUNK_CHARS),
  );
  return mergeShort(text, pieces).map((span) => spanText(text, span));
}

/**
 * Turns confirmed text into immutable chunks with code-assigned IDs. Pure and
 * deterministic: the same input always gives the same chunks.
 */
export function chunkDocument(input: ChunkInput): Chunk[] {
  const units = buildUnits(input);
  const digest = documentDigest(
    units.map((u) => u.text),
    input.sourceType,
  );
  const prefix = `chk_${digest.slice(0, 12)}_`;

  const chunks: Chunk[] = [];
  for (const unit of units) {
    const originals = new Set(chunkUnitText(unit.originalText));
    for (const text of chunkUnitText(unit.text)) {
      const position = chunks.length;
      chunks.push(
        Object.freeze({
          id: `${prefix}${position}`,
          documentDigest: digest,
          position,
          text,
          location: Object.freeze({ ...unit.location }) as SourceLocation,
          edited: !originals.has(text),
        }),
      );
    }
  }
  return chunks;
}
