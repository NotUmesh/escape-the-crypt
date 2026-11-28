import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  conflictReplyArb,
  docWithRoomArb,
  type ConflictReplyCase,
  type DocWithRoom,
} from '../test-support/conflict-report-arbitraries';
import { conflictShownId } from './conflict-prompt';
import { resolveConflictReports } from './conflict-report';

// Feature: generation-and-evaluation, Property 31: Only a resolvable, non-self report confirms a conflict

const caseArb: fc.Arbitrary<{ fixture: DocWithRoom; c: ConflictReplyCase }> = docWithRoomArb.chain((fixture) =>
  conflictReplyArb(fixture).map((c) => ({ fixture, c })),
);

describe('Property 31: only a resolvable, non-self report confirms a conflict', () => {
  it('confirms exactly the reports that pass every rule, and counts every other conflict report', () => {
    // Validates: Requirements 18.3, 18.4
    fc.assert(
      fc.property(caseArb, ({ fixture, c }) => {
        const r = resolveConflictReports(c.reply, c.room, fixture.doc);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const confirmedIds = c.expected.flatMap((e, i) => (e === 'confirmed' ? [conflictShownId(i)] : []));
        expect(r.value.confirmed.map((x) => x.shownId)).toEqual(confirmedIds);
        const ignored = c.expected.filter((e) => e === 'ignored').length;
        const noConflict = c.expected.filter((e) => e === 'none').length;
        expect(r.value.conflictReportsIgnored).toBe(ignored);
        expect(r.value.conflictReportsIgnored + r.value.confirmed.length + noConflict).toBe(c.reply.results.length);
        for (const item of r.value.confirmed) {
          const i = c.reply.results.findIndex((x) => x.questionId === item.shownId);
          expect(item.questionId).toBe(c.room[i]!.id);
          expect(item.conceptId).toBe(c.room[i]!.conceptId);
          expect(item.other.quote).toBe(c.otherQuote[i]);
          expect(item.other.chunkId).toBe(fixture.doc.quotableChunksByOrdinal.get(c.reply.results[i]!.paragraph!)!.id);
          expect(item.own.chunkId).not.toBe(item.other.chunkId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('returns the typed error when a reply repeats or misses a shown id', () => {
    // Validates: Requirements 18.3
    fc.assert(
      fc.property(caseArb, fc.boolean(), fc.nat(10), ({ fixture, c }, wantRepeat, pick) => {
        const results = [...c.reply.results];
        const at = pick % results.length;
        // One entry cannot repeat another id, so a one-question room can only miss one.
        const repeat = wantRepeat && results.length > 1;
        if (repeat) {
          results[at] = { ...results[at]!, questionId: results[(at + 1) % results.length]!.questionId };
        } else {
          results.splice(at, 1);
        }
        const r = resolveConflictReports({ results }, c.room, fixture.doc);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.kind).toBe(repeat ? 'conflict-reply-repeated-id' : 'conflict-reply-missing-id');
      }),
      { numRuns: 100 },
    );
  });
});
