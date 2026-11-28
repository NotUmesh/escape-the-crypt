import {
  MAX_FILE_SIZE_BYTES,
  apply,
  initial,
  isEvent,
  makeNotesRecord,
  parseCryptBundle,
  parseNotesRecord,
  sampleIdForManifestId,
} from '@escape-the-crypt/core';
import type {
  Chunk,
  Event,
  ImportErrorKind,
  NotesRecord,
  Result,
  RunSettings,
  SampleCryptError,
  SampleCryptResult,
  State,
} from '@escape-the-crypt/core';
import type { NotesStore } from '../../features/ingest/notes-store';
import { buildCryptForSample } from '../../features/crypt/sample-sources';
import { canonicalJson } from './crypt-repository';
import { ExportFileSchema } from './export-run';
import { notesChunks } from './notes-chunks';
import type { CryptRecord } from './records';

/** The largest file an import will read. The same cap a PDF has, which an export stays far under. */
export const MAX_IMPORT_BYTES = MAX_FILE_SIZE_BYTES;

export interface ImportError {
  readonly kind: ImportErrorKind;
}
export type ImportResult<T> = Result<T, ImportError>;

/** What a file holds once every part has been checked. Nothing here is taken from the file unchecked. */
export interface ValidatedImport {
  readonly crypt: CryptRecord;
  readonly settings: RunSettings;
  readonly events: readonly Event[];
  /** `escaped` when replaying the events reaches the escape, else `active`. */
  readonly status: 'active' | 'escaped';
  /** The notes record to keep for a generated crypt, or null for a sample. */
  readonly notes: NotesRecord | null;
}

export interface ValidateDeps {
  /**
   * The bundled sample a file may be a copy of, for telling it from a generated crypt. Defaults to the
   * bundled sample whose manifest ID the file names (human heart, HTTPS or printing press).
   */
  readonly buildSample?: () => Result<SampleCryptResult, SampleCryptError>;
}

const fail = (kind: ImportErrorKind): { ok: false; error: ImportError } => ({ ok: false, error: { kind } });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const EXPORT_KEYS = ['chunks', 'content', 'events', 'manifest', 'schemaVersion', 'settings'] as const;

/** Bytes of `text` as UTF-8, without building the bytes when the answer is clear from the length. */
function utf8Size(text: string): number {
  if (text.length * 3 <= MAX_IMPORT_BYTES) return text.length * 3;
  return new TextEncoder().encode(text).length;
}

/** True when the text is too large to read further. A character is at least one byte, so length alone can refuse. */
export function isTooLarge(text: string): boolean {
  return text.length > MAX_IMPORT_BYTES || utf8Size(text) > MAX_IMPORT_BYTES;
}

/**
 * Why `ExportFileSchema` refused a value, as one kind. Checked in a fixed order, from the outside
 * in, so the same file always gets the same message.
 */
function classify(raw: unknown): ImportErrorKind {
  if (!isRecord(raw)) return 'not-an-export';
  const keys = Object.keys(raw).sort();
  if (keys.length !== EXPORT_KEYS.length || keys.some((key, i) => key !== EXPORT_KEYS[i])) return 'not-an-export';
  const events = raw['events'];
  if (!Array.isArray(events) || !events.every((event) => isEvent(event))) return 'events-invalid';
  if (!parseCryptBundle({ manifest: raw['manifest'], content: raw['content'] }).ok) return 'crypt-invalid';
  return 'not-an-export';
}

/** Folds the events with the real reducer. Any rejected event, or an empty log, refuses the file. */
function replay(
  manifest: CryptRecord['manifest'],
  settings: RunSettings,
  events: readonly Event[],
): ImportResult<'active' | 'escaped'> {
  if (events.length === 0) return fail('events-invalid');
  try {
    let state: State = initial(manifest, settings);
    for (const event of events) {
      const next = apply(state, event);
      if (!next.ok) return fail('events-invalid');
      state = next.state;
    }
    return { ok: true, value: state.status === 'escaped' ? 'escaped' : 'active' };
  } catch {
    return fail('events-invalid');
  }
}

/** The bundled sample with this manifest ID: its normalised bundle and notes chunks, or null when it is not one. */
function bundledSample(manifestId: string, deps: ValidateDeps): { manifestId: string; canonical: string; chunks: string } | null {
  try {
    const id = sampleIdForManifestId(manifestId);
    const build = deps.buildSample ?? (id === null ? undefined : buildCryptForSample(id));
    if (build === undefined) return null;
    const built = build();
    if (!built.ok) return null;
    const bundle = parseCryptBundle({ manifest: built.value.manifest, content: built.value.content });
    if (!bundle.ok) return null;
    return {
      manifestId: bundle.value.manifest.manifestId,
      canonical: canonicalJson(bundle.value),
      chunks: canonicalJson([...built.value.chunks.values()]),
    };
  } catch {
    return null;
  }
}

/** A notes store that holds one record, so `notesChunks` can run its own consistency check on a file's notes. */
function holding(record: NotesRecord): NotesStore {
  return {
    save: () => Promise.resolve({ ok: true, value: true }),
    load: (digest) => Promise.resolve({ ok: true, value: digest === record.documentDigest ? record : null }),
  };
}

/**
 * Checks the notes of a generated crypt the way a restore reads them: they must parse as a notes
 * record, and the chunks rebuilt from their text must hold every chunk the questions cite.
 */
async function checkedNotes(
  chunks: readonly Chunk[],
  crypt: CryptRecord,
): Promise<ImportResult<NotesRecord>> {
  if (chunks.length === 0) return fail('no-notes');
  const record = parseNotesRecord(makeNotesRecord(chunks));
  if (!record.ok || record.value.documentDigest === '') return fail('notes-invalid');
  const withDigest: CryptRecord = { ...crypt, documentDigest: record.value.documentDigest };
  const rebuilt = await notesChunks({ notesStore: holding(record.value) }, withDigest);
  return rebuilt.ok ? { ok: true, value: record.value } : fail('notes-invalid');
}

/**
 * Turns the text of a file into a validated import, or one typed refusal. The file is untrusted:
 * a size cap, then a strict schema (no extra keys, no file name or bytes), then the crypt through
 * `parseCryptBundle` (which runs `validateManifestForPublish`), then each event through `isEvent`
 * and the real reducer. A copy of the bundled sample must equal the bundled sample, notes included; anything
 * else is a generated crypt and must carry notes that agree with its questions. Never throws, and
 * writes nothing.
 */
export async function validateImport(text: string, deps: ValidateDeps = {}): Promise<ImportResult<ValidatedImport>> {
  try {
    if (typeof text !== 'string' || isTooLarge(text)) return fail('too-large');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail('not-json');
    }
    const version = isRecord(raw) ? raw['schemaVersion'] : undefined;
    if (typeof version === 'number' && Number.isInteger(version) && version > 1) {
      return fail('unsupported-version');
    }
    const parsed = ExportFileSchema.safeParse(raw);
    if (!parsed.success) return fail(classify(raw));
    const file = parsed.data;
    // The manifest and content in `file` are as written. Only the bundle parser's output is kept.
    const bundle = parseCryptBundle({ manifest: file.manifest, content: file.content });
    if (!bundle.ok) return fail('crypt-invalid');
    const { manifest, content } = bundle.value;
    const status = replay(manifest, file.settings, file.events);
    if (!status.ok) return status;

    const sample = bundledSample(manifest.manifestId, deps);
    if (sample !== null && manifest.manifestId === sample.manifestId) {
      // Same identity as the bundled sample: it must be the bundled sample, not a lookalike.
      if (canonicalJson(bundle.value) !== sample.canonical) return fail('conflict');
      // Its notes, when the file has them, must be the bundled notes too: nothing in the file goes unchecked.
      if (file.chunks !== null && canonicalJson(file.chunks) !== sample.chunks) return fail('notes-invalid');
      const crypt: CryptRecord = { schemaVersion: 1, manifestId: manifest.manifestId, manifest, content, source: 'sample' };
      return { ok: true, value: { crypt, settings: file.settings, events: file.events, status: status.value, notes: null } };
    }
    if (file.chunks === null) return fail('no-notes');
    const base: CryptRecord = { schemaVersion: 1, manifestId: manifest.manifestId, manifest, content, source: 'generated' };
    const notes = await checkedNotes(file.chunks, base);
    if (!notes.ok) return notes;
    const crypt: CryptRecord = { ...base, documentDigest: notes.value.documentDigest };
    return { ok: true, value: { crypt, settings: file.settings, events: file.events, status: status.value, notes: notes.value } };
  } catch {
    return fail('not-an-export');
  }
}
