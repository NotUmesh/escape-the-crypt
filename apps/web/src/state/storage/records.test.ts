import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SAMPLE_BUNDLE } from '../../test-support/sample-bundle';
import { eventGuard } from './event-guard';
import { acceptedRunArb, runSettingsArb } from './persistence-arbitraries';
import { parseCryptRecord, parseEventRow, parseRunRecord } from './records';
import type { CryptRecord, EventRow, RunRecord } from './records';

/** Stored records come back from IndexedDB as plain cloned data. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const idArb = fc.string({ minLength: 1, maxLength: 12 });

const cryptRecordArb: fc.Arbitrary<CryptRecord> = fc
  .record({
    source: fc.constantFrom<'sample' | 'generated'>('sample', 'generated'),
    documentDigest: fc.option(idArb, { nil: undefined }),
  })
  .map(({ source, documentDigest }) => ({
    schemaVersion: 1 as const,
    manifestId: SAMPLE_BUNDLE.manifest.manifestId,
    manifest: SAMPLE_BUNDLE.manifest,
    content: SAMPLE_BUNDLE.content,
    source,
    ...(documentDigest === undefined ? {} : { documentDigest }),
  }));

const runRecordArb: fc.Arbitrary<RunRecord> = fc.record({
  schemaVersion: fc.constant(1 as const),
  runId: idArb,
  manifestId: idArb,
  settings: runSettingsArb,
  createdAt: fc.integer({ min: 0, max: 4_102_444_800_000 }),
  status: fc.constantFrom<'active' | 'escaped' | 'left'>('active', 'escaped', 'left'),
});

const badVersionArb = fc.oneof(
  fc.integer().filter((n) => n !== 1),
  fc.constantFrom<unknown>('1', null, undefined, 1.5),
);

describe('record round trips', () => {
  // Feature: persistence, Property 2: Crypt save-then-load round trip
  // **Validates: Requirements 4.7**
  it('a CryptRecord parses back to an equal value', () => {
    fc.assert(
      fc.property(cryptRecordArb, (record) => {
        const parsed = parseCryptRecord(clone(record));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.value).toEqual(record);
      }),
      { numRuns: 25 },
    );
  });

  // Feature: persistence, Property 6: Run creation round-trips its fields
  // **Validates: Requirements 4.7**
  it('a RunRecord parses back to an equal value', () => {
    fc.assert(
      fc.property(runRecordArb, (record) => {
        const parsed = parseRunRecord(clone(record));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.value).toEqual(record);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: persistence, Property 6: Event rows round-trip their fields
  // **Validates: Requirements 4.7**
  it('every EventRow parses back to an equal value', () => {
    fc.assert(
      fc.property(acceptedRunArb(15), idArb, ({ events }, runId) => {
        events.forEach((event, seq) => {
          const row: EventRow = { schemaVersion: 1, runId, seq, event };
          const parsed = parseEventRow(clone(row), eventGuard);
          expect(parsed.ok).toBe(true);
          if (parsed.ok) expect(parsed.value).toEqual(row);
        });
      }),
      { numRuns: 20 },
    );
  });

  // Feature: persistence, Property 6: Unknown schemaVersion is rejected
  // **Validates: Requirements 12.7**
  it('rejects an unknown schemaVersion with record-unreadable', () => {
    fc.assert(
      fc.property(
        cryptRecordArb,
        runRecordArb,
        acceptedRunArb(3),
        badVersionArb,
        (crypt, run, { events }, version) => {
          const unreadable = { ok: false, error: { kind: 'record-unreadable' } };
          expect(parseCryptRecord({ ...clone(crypt), schemaVersion: version })).toEqual(unreadable);
          expect(parseRunRecord({ ...clone(run), schemaVersion: version })).toEqual(unreadable);
          const row = { schemaVersion: version, runId: 'r', seq: 0, event: clone(events[0]) };
          expect(parseEventRow(row, eventGuard)).toEqual(unreadable);
        },
      ),
      { numRuns: 25 },
    );
  });
});
