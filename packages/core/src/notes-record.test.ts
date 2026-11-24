import { describe, expect, it } from 'vitest';
import { NOTES_SCHEMA_VERSION, makeNotesRecord, parseNotesRecord } from './notes-record';
import type { Chunk } from './types';

const DIGEST = 'a'.repeat(64);
const chunks: Chunk[] = [
  {
    id: 'chk_aaaaaaaaaaaa_0',
    documentDigest: DIGEST,
    position: 0,
    text: 'Active recall means producing an answer from memory.',
    location: { sourceType: 'pdf', pdfPageIndex: 2, printedPageLabel: 'iv' },
    edited: false,
  },
  {
    id: 'chk_aaaaaaaaaaaa_1',
    documentDigest: DIGEST,
    position: 1,
    text: 'Spaced repetition schedules each review.',
    location: { sourceType: 'paste', paragraphNumber: 2 },
    edited: true,
  },
];

describe('notes record', () => {
  it('names the schema version as the integer 1', () => {
    expect(Number.isInteger(NOTES_SCHEMA_VERSION)).toBe(true);
    expect(NOTES_SCHEMA_VERSION).toBe(1);
  });

  it('holds only the schema version, the digest and the chunks', () => {
    const record = makeNotesRecord(chunks);
    expect(Object.keys(record).sort()).toEqual(['chunks', 'documentDigest', 'schemaVersion']);
    expect(record.schemaVersion).toBe(NOTES_SCHEMA_VERSION);
    expect(record.documentDigest).toBe(DIGEST);
    expect(record.chunks).toEqual(chunks);
  });

  it('round-trips through parseNotesRecord, including through JSON', () => {
    const record = makeNotesRecord(chunks);
    expect(parseNotesRecord(record)).toEqual({ ok: true, value: record });
    expect(parseNotesRecord(JSON.parse(JSON.stringify(record)))).toEqual({ ok: true, value: record });
  });

  it('returns a typed error, without throwing, for malformed values', () => {
    const good = makeNotesRecord(chunks);
    const bad: unknown[] = [
      null,
      42,
      'x',
      [],
      {},
      { ...good, schemaVersion: '1' },
      { ...good, schemaVersion: NOTES_SCHEMA_VERSION + 1 },
      { ...good, documentDigest: 7 },
      { ...good, chunks: 'nope' },
      { ...good, chunks: [{ ...chunks[0], text: 5 }] },
      { ...good, chunks: [{ ...chunks[0], documentDigest: 'b'.repeat(64) }] },
      { ...good, chunks: [{ ...chunks[0], location: { sourceType: 'web' } }] },
    ];
    for (const value of bad) {
      expect(parseNotesRecord(value)).toEqual({ ok: false, error: { kind: 'invalid-record' } });
    }
  });
});