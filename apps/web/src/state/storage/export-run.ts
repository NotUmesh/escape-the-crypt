import { isEvent, parseCryptBundle, z } from '@escape-the-crypt/core';
import type { Chunk, CryptContent, CryptManifest, Event, RunSettings } from '@escape-the-crypt/core';
import type { CryptRecord, RunRecord } from './records';
import { RunSettingsSchema } from './run-settings-schema';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

/**
 * The downloadable copy of a run (Req 13.1). It has no field for an original file, a file name
 * or PDF bytes, and the strict schemas reject any extra key (Req 13.2).
 */
export interface ExportFile {
  readonly schemaVersion: 1;
  /** The notes chunks, or `null` when the notes are unavailable (Req 13.6). */
  readonly chunks: readonly Chunk[] | null;
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  readonly settings: RunSettings;
  readonly events: readonly Event[];
}

export interface ExportInput {
  readonly crypt: CryptRecord;
  readonly run: RunRecord;
  /** The in-memory accepted events, including any that failed to save (Req 13.5). */
  readonly acceptedEvents: readonly Event[];
  /** The notes chunks, or `null` when unavailable. */
  readonly chunks: readonly Chunk[] | null;
}

const SourceLocationSchema = z.union([
  z
    .object({
      sourceType: z.literal('pdf'),
      pdfPageIndex: z.number().int().min(0),
      printedPageLabel: z.string().nullable(),
    })
    .strict(),
  z.object({ sourceType: z.literal('paste'), paragraphNumber: z.number().int().min(0) }).strict(),
]);

const ChunkSchema = z
  .object({
    id: z.string().min(1),
    documentDigest: z.string().min(1),
    position: z.number().int().min(0),
    text: z.string(),
    location: SourceLocationSchema,
    edited: z.boolean(),
  })
  .strict();

/** Strict Zod schema for `ExportFile`. Manifest and content are checked by core's bundle parser. */
export const ExportFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    chunks: z.array(ChunkSchema).nullable(),
    manifest: z.custom<CryptManifest>((value) => typeof value === 'object' && value !== null),
    content: z.custom<CryptContent>((value) => typeof value === 'object' && value !== null),
    settings: RunSettingsSchema,
    events: z.array(z.custom<Event>(isEvent)),
  })
  .strict()
  .refine((file) => parseCryptBundle({ manifest: file.manifest, content: file.content }).ok);

/**
 * Builds the Export_File from a crypt, a run and the in-memory accepted events. Pure; never
 * throws. Events come from `acceptedEvents`, not from the database (Req 13.5). The file is
 * parsed with the strict schema before it is returned.
 */
export function buildExport(input: ExportInput): StorageResult<ExportFile> {
  try {
    const { crypt, run, acceptedEvents, chunks } = input;
    if (run.manifestId !== crypt.manifestId) return storageError('record-unreadable');
    const candidate: ExportFile = {
      schemaVersion: 1,
      chunks: chunks === null ? null : [...chunks],
      manifest: crypt.manifest,
      content: crypt.content,
      settings: run.settings,
      events: [...acceptedEvents],
    };
    const parsed = ExportFileSchema.safeParse(candidate);
    if (!parsed.success) return storageError('record-unreadable');
    return { ok: true, value: candidate };
  } catch {
    return storageError('record-unreadable');
  }
}

/** The JSON text of an Export_File. Never throws. */
export function exportToJson(file: ExportFile): StorageResult<string> {
  try {
    return { ok: true, value: JSON.stringify(file) };
  } catch {
    return storageError('record-unreadable');
  }
}
