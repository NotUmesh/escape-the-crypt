import { z } from './zod';
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

const isInteger = (n: number): boolean => Number.isInteger(n);

const indexSchema = z.number().refine((n) => isInteger(n) && n >= 0);

const locationSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('pdf'),
    pdfPageIndex: indexSchema,
    printedPageLabel: z.string().nullable(),
  }),
  z.object({
    sourceType: z.literal('paste'),
    paragraphNumber: z.number().refine((n) => isInteger(n) && n >= 1),
  }),
]);

const chunkSchema = z.object({
  id: z.string(),
  documentDigest: z.string(),
  position: indexSchema,
  text: z.string(),
  location: locationSchema,
  edited: z.boolean(),
});

const notesRecordSchema = z
  .object({
    schemaVersion: z.number().refine((n) => isInteger(n) && n >= 1 && n <= NOTES_SCHEMA_VERSION),
    documentDigest: z.string(),
    chunks: z.array(chunkSchema),
  })
  .refine((r) => r.chunks.every((c) => c.documentDigest === r.documentDigest));

/**
 * Checks a value read back from storage. Returns a typed error for anything that
 * is not a record this version understands (including a newer schemaVersion),
 * and never throws.
 */
export function parseNotesRecord(value: unknown): Result<NotesRecord, { kind: 'invalid-record' }> {
  try {
    const parsed = notesRecordSchema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data };
  } catch {
    // A hostile value (throwing getter or proxy) is simply not a valid record.
  }
  return { ok: false, error: { kind: 'invalid-record' } };
}