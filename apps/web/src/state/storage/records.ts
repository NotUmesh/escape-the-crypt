import { parseCryptBundle, z } from '@escape-the-crypt/core';
import type { CryptContent, CryptManifest, Event, RunSettings } from '@escape-the-crypt/core';
import type { EventGuard } from './event-guard';
import { RunSettingsSchema } from './run-settings-schema';
import { storageError } from './storage-error';
import type { StorageResult } from './storage-error';

export interface CryptRecord {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly manifest: CryptManifest;
  readonly content: CryptContent;
  readonly source: 'sample' | 'generated';
  /** Present when `source` is `generated`. */
  readonly documentDigest?: string;
}

export interface RunRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly manifestId: string;
  readonly settings: RunSettings;
  /** Epoch ms, supplied by the caller. */
  readonly createdAt: number;
  readonly status: 'active' | 'escaped' | 'left';
}

export interface EventRow {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly seq: number;
  readonly event: Event;
}

// manifest and content stay `unknown` here; core's parseCryptBundle owns their shape.
const CryptEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  manifestId: z.string().min(1),
  manifest: z.unknown(),
  content: z.unknown(),
  source: z.enum(['sample', 'generated']),
  documentDigest: z.string().min(1).optional(),
});

const RunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  manifestId: z.string().min(1),
  settings: RunSettingsSchema,
  createdAt: z.number().finite(),
  status: z.enum(['active', 'escaped', 'left']),
});

// Identifiers and numbers only; the event payload is checked by the guard.
const EventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  seq: z.number().int().min(0),
  event: z.unknown(),
});

const unreadable = (): { ok: false; error: { kind: 'record-unreadable' } } =>
  storageError('record-unreadable') as { ok: false; error: { kind: 'record-unreadable' } };

export function parseCryptRecord(raw: unknown): StorageResult<CryptRecord> {
  const envelope = CryptEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return unreadable();
  const { manifestId, manifest, content, source, documentDigest } = envelope.data;
  const bundle = parseCryptBundle({ manifest, content });
  if (!bundle.ok) return unreadable();
  if (bundle.value.manifest.manifestId !== manifestId) return unreadable();
  const record: CryptRecord = {
    schemaVersion: 1,
    manifestId,
    manifest: bundle.value.manifest,
    content: bundle.value.content,
    source,
    ...(documentDigest === undefined ? {} : { documentDigest }),
  };
  return { ok: true, value: record };
}

export function parseRunRecord(raw: unknown): StorageResult<RunRecord> {
  const parsed = RunRecordSchema.safeParse(raw);
  if (!parsed.success) return unreadable();
  return { ok: true, value: parsed.data };
}

export function parseEventRow(raw: unknown, isEvent: EventGuard): StorageResult<EventRow> {
  const envelope = EventEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return unreadable();
  const { runId, seq, event } = envelope.data;
  if (!isEvent(event)) return unreadable();
  return { ok: true, value: { schemaVersion: 1, runId, seq, event } };
}
