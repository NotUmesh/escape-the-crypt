import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from '@escape-the-crypt/core';
import type { Chunk } from '@escape-the-crypt/core';
import { buildExport, exportToJson, ExportFileSchema } from './export-run';
import { contentArb, persistableRunArb } from './persistable-run-support';
import type { CryptRecord, RunRecord } from './records';

// Feature: persistence, Property 21: Export reflects the in-memory run, not just what was saved
// **Validates: Requirements 13.1, 13.2, 13.5, 13.6**

const paragraphArb = fc.stringMatching(/^[A-Za-z][A-Za-z ,.]{40,160}[A-Za-z]$/);

const chunksArb: fc.Arbitrary<readonly Chunk[] | null> = fc.option(
  fc.array(paragraphArb, { minLength: 1, maxLength: 4 }).map((paragraphs) => {
    const text = paragraphs.join('\n\n');
    return chunkDocument({ sourceType: 'paste', text, originalText: text });
  }),
  { nil: null },
);

const scenarioArb = persistableRunArb.chain((run) =>
  fc.tuple(contentArb(run.manifest), chunksArb, fc.nat({ max: run.events.length })).map(([content, chunks, savedCount]) => ({
    run,
    content,
    chunks,
    savedCount,
  })),
);

const FORBIDDEN_KEYS = /"(fileName|filename|originalFile|file|pdfBytes|pdf|bytes|blob)"\s*:/i;

describe('buildExport', () => {
  it('exports the full in-memory events, parses strictly and keeps null chunks null', () => {
    fc.assert(
      fc.property(scenarioArb, ({ run, content, chunks, savedCount }) => {
        const crypt: CryptRecord = {
          schemaVersion: 1,
          manifestId: run.manifest.manifestId,
          manifest: run.manifest,
          content,
          source: 'generated',
          documentDigest: 'digest',
        };
        const record: RunRecord = {
          schemaVersion: 1,
          runId: 'run-1',
          manifestId: run.manifest.manifestId,
          settings: run.settings,
          createdAt: 0,
          status: 'active',
        };
        // Only the first `savedCount` events reached the database; the rest are unsaved.
        const unsaved = run.events.slice(savedCount);
        const result = buildExport({ crypt, run: record, acceptedEvents: run.events, chunks });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const file = result.value;

        expect(file.events).toEqual(run.events);
        expect(file.events.slice(savedCount)).toEqual(unsaved);
        expect(file.chunks === null).toBe(chunks === null);
        if (chunks !== null) expect(file.chunks).toEqual(chunks);

        const json = exportToJson(file);
        expect(json.ok).toBe(true);
        if (!json.ok) return;
        expect(json.value).not.toMatch(FORBIDDEN_KEYS);
        const reparsed = ExportFileSchema.safeParse(JSON.parse(json.value));
        expect(reparsed.success).toBe(true);
        expect(Object.keys(JSON.parse(json.value) as object).sort()).toEqual(
          ['chunks', 'content', 'events', 'manifest', 'schemaVersion', 'settings'],
        );
      }),
      { numRuns: 50 },
    );
  });
});
