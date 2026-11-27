import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AuthoringQuestion } from '../authoring/schema';
import { duplicateAnswerScan, keyedSpec } from '../checks/duplicate-answers';
import { leakScanRoom } from '../checks/leak-scan';
import { visibleTextOf } from '../checks/run-checks';
import { RUN_LENGTHS, cryptTargetFor } from '../run-length';
import { validateManifestForPublish } from '../runtime/publish-manifest';
import { assembleCrypt } from './crypt-assembly';
import { heart, hh } from './room-assembly-heart-fixtures';
import { assembleRoom, type AssemblyConcept, type RoomAssembly } from './room-assembly';

// Questions drawn from the human-heart sample: runes q01 q04 q08 q12, séances q02 q03 q06, and
// a variant whose séance key repeats a rune answer.
const POOL: readonly ((conceptId: string, role: 'primary' | 'alternate') => AuthoringQuestion)[] = [
  (c, r) => hh('hh-q01', { conceptId: c, role: r }),
  (c, r) => hh('hh-q04', { conceptId: c, role: r }),
  (c, r) => hh('hh-q08', { conceptId: c, role: r }),
  (c, r) => hh('hh-q12', { conceptId: c, role: r }),
  (c, r) => hh('hh-q02', { conceptId: c, role: r }),
  (c, r) => hh('hh-q03', { conceptId: c, role: r }),
  (c, r) => hh('hh-q06', { conceptId: c, role: r }),
];

const questionArb = (conceptId: string, role: 'primary' | 'alternate') =>
  fc.option(fc.nat({ max: POOL.length - 1 }).map((i) => (POOL[i] as (typeof POOL)[number])(conceptId, role)), {
    nil: null,
    freq: role === 'primary' ? 6 : 2,
  });

const conceptsArb: fc.Arbitrary<AssemblyConcept[]> = fc
  .integer({ min: 1, max: 8 })
  .chain((n) =>
    fc.tuple(
      ...Array.from({ length: n }, (_, i) => {
        const conceptId = `k${i + 1}`;
        return fc.record({
          conceptId: fc.constant(conceptId),
          label: fc.constant(`Label ${conceptId}`),
          primary: questionArb(conceptId, 'primary'),
          alternate: questionArb(conceptId, 'alternate'),
        });
      }),
    ),
  );

const build = (concepts: readonly AssemblyConcept[], length: (typeof RUN_LENGTHS)[number]): RoomAssembly | null => {
  const result = assembleCrypt({ manifestId: 'crypt-p', document: heart, concepts }, cryptTargetFor(length));
  return result.ok ? result.value : null;
};

/** Independent reference: the most disjoint two-lock rooms that single-room assembly allows. */
function bestRooms(concepts: readonly AssemblyConcept[], cap: number): number {
  const viable: [number, number][] = [];
  for (let a = 0; a < concepts.length; a += 1) {
    for (let b = a + 1; b < concepts.length; b += 1) {
      for (const order of [[a, b], [b, a]] as const) {
        const r = assembleRoom({ manifestId: 'm', document: heart, concepts: [concepts[order[0]] as AssemblyConcept, concepts[order[1]] as AssemblyConcept] });
        if (r.ok && r.value.manifest.rooms.flatMap((x) => x.lockSlots).length === 2) {
          viable.push([a, b]);
          break;
        }
      }
    }
  }
  return viable.length === 0 ? 0 : Math.min(cap, upperBound(viable));
}
/** Largest disjoint selection (ignoring cross-room checks, so an upper bound). */
function upperBound(pairs: readonly [number, number][]): number {
  let best = 0;
  const go = (from: number, used: Set<number>, n: number): void => {
    best = Math.max(best, n);
    for (let p = from; p < pairs.length; p += 1) {
      const [a, b] = pairs[p] as [number, number];
      if (used.has(a) || used.has(b)) continue;
      used.add(a);
      used.add(b);
      go(p + 1, used, n + 1);
      used.delete(a);
      used.delete(b);
    }
  };
  go(0, new Set(), 0);
  return best;
}

// Feature: run length and difficulty, multi-room assembly
describe('Property: an assembled crypt is sound across rooms', () => {
  it('has at most the target rooms, two locks of different concepts each, and publishes', () => {
    fc.assert(
      fc.property(conceptsArb, fc.constantFrom(...RUN_LENGTHS), (concepts, length) => {
        const a = build(concepts, length);
        if (a === null) return;
        const rooms = a.manifest.rooms;
        expect(rooms.length).toBeGreaterThanOrEqual(1);
        expect(rooms.length).toBeLessThanOrEqual(cryptTargetFor(length).rooms);
        const owners = rooms.flatMap((r) => r.lockSlots.map((s) => s.conceptId));
        for (const r of rooms) {
          expect(r.lockSlots).toHaveLength(2);
          expect(new Set(r.lockSlots.map((s) => s.stationType)).size).toBe(2);
        }
        expect(new Set(owners).size).toBe(owners.length);
        expect(validateManifestForPublish({ ...a.manifest }).ok).toBe(true);
        expect(a.manifest.rooms.map((r) => r.roomId)).toEqual(rooms.map((_, i) => `room-${i + 1}`));
      }),
      { numRuns: 120 },
    );
  });

  it('has no repeated answer and no rune answer showing in another concept anywhere in the crypt', () => {
    fc.assert(
      fc.property(conceptsArb, (concepts) => {
        const a = build(concepts, 'long');
        if (a === null) return;
        const placed = a.manifest.rooms.flatMap((r) =>
          r.lockSlots.flatMap((s) =>
            [s.primaryQuestion, s.alternateQuestion].flatMap((q) => (q === null ? [] : [{ conceptId: s.conceptId, spec: q }])),
          ),
        );
        expect(duplicateAnswerScan(placed.map((p) => keyedSpec(p.conceptId, p.spec, a.content.questions[p.spec.questionId])))).toEqual([]);
        const byId = new Map(concepts.map((c) => [c.conceptId, c] as const));
        const entries = placed.flatMap((p) => {
          const c = byId.get(p.conceptId);
          const q = p.spec.questionId.endsWith('-alternate') ? c?.alternate : c?.primary;
          return c === undefined || q == null ? [] : [{ conceptId: p.conceptId, question: q, visibleText: visibleTextOf(q) }];
        });
        expect(leakScanRoom(entries)).toEqual([]);
      }),
      { numRuns: 120 },
    );
  });

  it('is deterministic, and every question appears at most once', () => {
    fc.assert(
      fc.property(conceptsArb, (concepts) => {
        const a = build(concepts, 'standard');
        expect(build(concepts, 'standard')).toEqual(a);
        if (a === null) return;
        const ids = Object.keys(a.content.questions);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 60 },
    );
  });

  it('builds a crypt exactly when some pair of concepts can make a room, and never more rooms than disjoint pairs allow', () => {
    fc.assert(
      fc.property(conceptsArb, (concepts) => {
        const a = build(concepts, 'long');
        const bound = bestRooms(concepts, 4);
        // Never more rooms than viable disjoint pairs; no pair means no crypt.
        expect(a === null ? 0 : a.manifest.rooms.length).toBeLessThanOrEqual(bound);
        if (bound === 0) expect(a).toBeNull();
        // Whenever the bound is 1 (one room is all the pairs allow), a crypt exists.
        if (bound >= 1) expect(a).not.toBeNull();
      }),
      { numRuns: 80 },
    );
  });
});
