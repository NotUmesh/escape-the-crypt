export type SourceType = 'pdf' | 'paste';

export type SourceLocation =
  | { sourceType: 'pdf'; pdfPageIndex: number; printedPageLabel: string | null }
  | { sourceType: 'paste'; paragraphNumber: number };

export interface Chunk {
  readonly id: string; // chk_<digest12>_<position>
  readonly documentDigest: string; // sha-256 hex of confirmed text
  readonly position: number; // 0-based position in the document
  readonly text: string;
  readonly location: SourceLocation; // exactly one location
  readonly edited: boolean;
}

export type PageFlag = 'ok' | 'low-text' | 'suspicious';

export interface ResolvedLocation {
  readonly chunkId: string;
  readonly start: number; // offset in original, unnormalised chunk text
  readonly end: number; // exclusive
}

export type QuoteError =
  | { kind: 'not-found' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'unknown-chunk' }
  | { kind: 'too-short' };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type LimitError =
  | { kind: 'file-size'; limitBytes: number }
  | { kind: 'page-count'; limit: number }
  | { kind: 'word-count'; limit: number }
  | { kind: 'time'; limitMs: number };

export type IngestError =
  | LimitError
  | { kind: 'encrypted' }
  | { kind: 'unreadable' }
  | { kind: 'empty' }
  | { kind: 'storage-unavailable' };
