import { chunkDocument, type ChunkInput } from '../chunker';
import { isHeadingOnlyChunk } from '../chunker-heading';
import type { EvidenceContext } from '../checks/run-checks';
import type { DocumentChunkMaps } from '../mapper/manifest-mapper';
import type { Chunk, Result } from '../types';

export interface PreparedDocument {
  /** Code-assigned ordinal -> chunk, over QUOTABLE chunks only, 1-based. */
  readonly quotableChunksByOrdinal: ReadonlyMap<number, Chunk>;
  /** The same map inverted, keyed by chunk ID. */
  readonly ordinalByChunkId: ReadonlyMap<string, number>;
  /** Every chunk, quotable or not, keyed by ID. */
  readonly chunks: ReadonlyMap<string, Chunk>;
  /** Heading-only chunks' text: context for the model, never a numbered or quotable item. */
  readonly headingContext: readonly string[];
}

/** A chunk ID the model cited that is not a quotable chunk of this document (Req 13.5). */
export type PrepareError = { readonly kind: 'pipeline-unknown-chunk'; readonly chunkId: string };

/** Input: pasted notes text, a full `chunkDocument` input (text or PDF pages), or ready chunks. */
export type PrepareSource = string | ChunkInput | readonly Chunk[];

function chunksOf(source: PrepareSource): readonly Chunk[] {
  if (typeof source === 'string') {
    return chunkDocument({ sourceType: 'paste', text: source, originalText: source });
  }
  if (Array.isArray(source)) return source as readonly Chunk[];
  return chunkDocument(source as ChunkInput);
}

/** Splits chunks into quotable (numbered 1..n by position order) and heading context. Pure and total. */
export function prepareDocument(source: PrepareSource): PreparedDocument {
  const ordered = [...chunksOf(source)].sort((a, b) => a.position - b.position);
  const quotableChunksByOrdinal = new Map<number, Chunk>();
  const ordinalByChunkId = new Map<string, number>();
  const chunks = new Map<string, Chunk>();
  const headingContext: string[] = [];
  let ordinal = 0;
  for (const chunk of ordered) {
    chunks.set(chunk.id, chunk);
    if (isHeadingOnlyChunk(chunk)) {
      headingContext.push(chunk.text);
      continue;
    }
    ordinal += 1;
    quotableChunksByOrdinal.set(ordinal, chunk);
    ordinalByChunkId.set(chunk.id, ordinal);
  }
  return { quotableChunksByOrdinal, ordinalByChunkId, chunks, headingContext };
}

/** Translates a cited chunk ID to its ordinal, or rejects an ID that is not quotable. */
export function translateChunkId(
  prepared: PreparedDocument,
  chunkId: string,
): Result<number, PrepareError> {
  const ordinal = prepared.ordinalByChunkId.get(chunkId);
  return ordinal === undefined
    ? { ok: false, error: { kind: 'pipeline-unknown-chunk', chunkId } }
    : { ok: true, value: ordinal };
}

/** Quotable chunks only, keyed by ID. A heading's ID is absent, so citing it fails the lookup. */
function quotableChunksById(prepared: PreparedDocument): Map<string, Chunk> {
  const out = new Map<string, Chunk>();
  for (const chunk of prepared.quotableChunksByOrdinal.values()) out.set(chunk.id, chunk);
  return out;
}

function chunkIdsByOrdinal(prepared: PreparedDocument): Map<number, string> {
  const out = new Map<number, string>();
  for (const [ordinal, chunk] of prepared.quotableChunksByOrdinal) out.set(ordinal, chunk.id);
  return out;
}

/** `mapAuthoringQuestionToSpec` input: ordinal is the "paragraph" key; headings are excluded. */
export function toDocumentChunkMaps(prepared: PreparedDocument): DocumentChunkMaps {
  return { chunks: quotableChunksById(prepared), chunksByParagraph: chunkIdsByOrdinal(prepared) };
}

/** `runChecks` input: ordinal is the "paragraph" key; headings are excluded. */
export function toEvidenceContext(prepared: PreparedDocument): EvidenceContext {
  return { chunks: quotableChunksById(prepared), paragraphChunkIds: chunkIdsByOrdinal(prepared) };
}
