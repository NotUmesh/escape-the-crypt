import type { Chunk, NotesRecord, Result, SourceLocation } from './types';

export const NOTES_SCHEMA_VERSION = 1;

/**
 * Builds the record from chunks only. The input has no field for file bytes or
 * any other content, so nothing else can reach the record.
 */
export function makeNotesRecord(chunks: readonly Chunk[]): NotesRecord {
  return {
    schemaVersion: NOTES_SCHEMA_VERSION,
    documentDigest: chunks[0]?.documentDigest ?? '',
    chunks: chunks.map((c) => ({
      id: c.id,
      documentDigest: c.documentDigest,
      position: c.position,
      text: c.text,
      location: copyLocation(c.location),
      edited: c.edited,
    })),
  };
}

function copyLocation(location: SourceLocation): SourceLocation {
  return location.sourceType === 'pdf'
    ? {
        sourceType: 'pdf',
        pdfPageIndex: location.pdfPageIndex,
        printedPageLabel: location.printedPageLabel,
      }
    : { sourceType: 'paste', paragraphNumber: location.paragraphNumber };
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseLocation(value: unknown): SourceLocation | null {
  if (!isObject(value)) return null;
  if (value['sourceType'] === 'pdf') {
    const label = value['printedPageLabel'];
    if (!isIndex(value['pdfPageIndex']) || !(label === null || typeof label === 'string')) return null;
    return { sourceType: 'pdf', pdfPageIndex: value['pdfPageIndex'], printedPageLabel: label };
  }
  if (value['sourceType'] === 'paste') {
    const n = value['paragraphNumber'];
    return typeof n === 'number' && Number.isInteger(n) && n >= 1
      ? { sourceType: 'paste', paragraphNumber: n }
      : null;
  }
  return null;
}

function parseChunk(value: unknown, digest: string): Chunk | null {
  if (!isObject(value)) return null;
  const location = parseLocation(value['location']);
  const { id, documentDigest, position, text, edited } = value;
  if (
    location === null ||
    typeof id !== 'string' ||
    documentDigest !== digest ||
    !isIndex(position) ||
    typeof text !== 'string' ||
    typeof edited !== 'boolean'
  ) {
    return null;
  }
  return { id, documentDigest: digest, position, text, location, edited };
}

/**
 * Checks a value read back from storage. Returns a typed error for anything that
 * is not a record this version understands (including a newer schemaVersion),
 * and never throws.
 */
export function parseNotesRecord(value: unknown): Result<NotesRecord, { kind: 'invalid-record' }> {
  const invalid = { ok: false, error: { kind: 'invalid-record' } } as const;
  if (!isObject(value)) return invalid;
  const { schemaVersion, documentDigest, chunks } = value;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > NOTES_SCHEMA_VERSION ||
    typeof documentDigest !== 'string' ||
    !Array.isArray(chunks)
  ) {
    return invalid;
  }
  const parsed: Chunk[] = [];
  for (const item of chunks as unknown[]) {
    const chunk = parseChunk(item, documentDigest);
    if (chunk === null) return invalid;
    parsed.push(chunk);
  }
  return { ok: true, value: { schemaVersion, documentDigest, chunks: parsed } };
}