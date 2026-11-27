import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isHeadingOnlyChunk } from '../chunker-heading';
import { paragraphArb } from '../test-support/arbitraries';
import { prepareDocument, translateChunkId } from './prepare-input';

const headingArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[A-Z]{3,9}$/), { minLength: 1, maxLength: 4 })
  .map((ws) => ws.join(' '));

/** Notes of paragraphs interleaved with some all-caps heading paragraphs. */
const notesArb: fc.Arbitrary<string> = fc
  .array(fc.oneof({ weight: 3, arbitrary: paragraphArb }, { weight: 1, arbitrary: headingArb }), {
    minLength: 1,
    maxLength: 10,
  })
  .map((ps) => ps.join('\n\n'));

describe('prepareDocument chunk ID translation', () => {
  // Feature: generation-and-evaluation, Property 20: Prepared documents reject chunk IDs code did not assign
  it('Property 20: translates only assigned quotable IDs; rejects everything else', () => {
    // **Validates: Requirements 13.5**
    fc.assert(
      fc.property(
        notesArb,
        notesArb,
        fc.string({ maxLength: 40 }),
        fc.integer({ min: 0, max: 1000 }),
        (notes, otherNotes, randomId, extra) => {
          const prepared = prepareDocument(notes);
          const other = prepareDocument(otherNotes);
          const assigned = new Set(prepared.ordinalByChunkId.keys());

          // Quotable IDs translate to their ordinal and round-trip.
          for (const [ordinal, chunk] of prepared.quotableChunksByOrdinal) {
            const r = translateChunkId(prepared, chunk.id);
            expect(r).toEqual({ ok: true, value: ordinal });
            expect(prepared.quotableChunksByOrdinal.get(ordinal)?.id).toBe(chunk.id);
          }

          // Heading-only IDs are rejected.
          for (const chunk of prepared.chunks.values()) {
            if (!isHeadingOnlyChunk(chunk)) continue;
            expect(translateChunkId(prepared, chunk.id)).toEqual({
              ok: false,
              error: { kind: 'pipeline-unknown-chunk', chunkId: chunk.id },
            });
          }

          // Unassigned IDs: random strings, other-document IDs, right prefix with out-of-range position.
          const anyChunk = [...prepared.chunks.values()][0];
          const prefix = anyChunk ? anyChunk.id.replace(/\d+$/, '') : 'chk_';
          const candidates = [
            randomId,
            '',
            ...other.chunks.keys(),
            `${prefix}${prepared.chunks.size + extra}`,
            `${prefix}-1`,
            `${prefix}x`,
          ];
          for (const id of candidates) {
            const r = translateChunkId(prepared, id);
            if (assigned.has(id)) {
              expect(r.ok).toBe(true);
            } else {
              expect(r).toEqual({
                ok: false,
                error: { kind: 'pipeline-unknown-chunk', chunkId: id },
              });
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
