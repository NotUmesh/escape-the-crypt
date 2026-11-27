import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { BoundThreadsAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import { CryptManifestSchema, QuestionSpecSchema } from '../runtime/manifest-schema';
import { buildManifest } from '../test-support/manifest-fixture';
import type { Chunk } from '../types';
import { mapBoundThreadsPayload } from './bound-threads';
import { boundThreadsChecks, checkNotOneToOne, checkPairCount } from './bound-threads-checks';

// packages/core compiles without Node types, so load Node modules dynamically.
interface FsLike {
  readFileSync(path: string, enc: string): string;
  readdirSync(path: string): string[];
}
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as FsLike;
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const root = `${here}/../../../..`;

const ids = (failures: readonly { checkId: string }[]): string[] => failures.map((f) => f.checkId);

const evidence = { paragraph: 1, quote: 'q' };
const text = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() !== '');
// Distinct after the check's normalisation (case and whitespace), so uniqueness is real.
const distinct = (min: number, max: number) =>
  fc.uniqueArray(text, { minLength: min, maxLength: max, selector: (s) => s.toLowerCase().replace(/\s+/g, ' ').trim() });
const pairsArb = (min: number, max: number) =>
  fc
    .tuple(distinct(min, max), distinct(min, max))
    .filter(([l, r]) => l.length === r.length)
    .map(([l, r]) => l.map((left, i) => ({ left, right: r[i]!, evidence })));

function inputOf(pairs: readonly { left: string; right: string; evidence: typeof evidence }[]) {
  return { id: 'q', pairs };
}
function specOf(payload: unknown, hintEffect: unknown) {
  return { questionId: 'q', lockType: 'bound-threads', payload, evidenceRefs: ['c1'], hintEffect };
}

describe('bound-threads properties', () => {
  // Feature: generation-and-evaluation, Property 22: Count checks reject out-of-range counts and accept in-range counts
  // **Validates: Requirements 22.2**
  it('Property 22: pair-count fails exactly when the count is outside 3 to 4', () => {
    fc.assert(
      fc.property(fc.nat({ max: 8 }), (n) => {
        const pairs = Array.from({ length: n }, (_, i) => ({ left: `l${i}`, right: `r${i}`, evidence }));
        const inRange = n >= 3 && n <= 4;
        expect(ids(checkPairCount(inputOf(pairs)))).toEqual(inRange ? [] : ['pair-count']);
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 26: Bound threads are rejected unless every left and every right item is distinct
  // **Validates: Requirements 22.2**
  describe('Property 26', () => {
    it('accepts pairs whose lefts and rights are all distinct', () => {
      fc.assert(
        fc.property(pairsArb(3, 4), (pairs) => {
          expect(ids(checkNotOneToOne(inputOf(pairs)))).toEqual([]);
        }),
      );
    });

    it('rejects a repeated left or right, even differing in case or spacing', () => {
      fc.assert(
        fc.property(pairsArb(3, 4), fc.boolean(), fc.boolean(), fc.nat(), (pairs, side, loud, i) => {
          const from = i % pairs.length;
          const to = (from + 1) % pairs.length;
          const key = side ? 'left' : 'right';
          const copy = loud ? ` ${pairs[from]![key].toUpperCase()} ` : pairs[from]![key];
          const bad = pairs.map((p, k) => (k === to ? { ...p, [key]: copy } : p));
          expect(ids(checkNotOneToOne(inputOf(bad)))).toEqual(['not-one-to-one']);
        }),
      );
    });
  });

  // Feature: generation-and-evaluation, Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch
  // **Validates: Requirements 22.8**
  describe('Property 28 (bound-threads part)', () => {
    const mappedArb = pairsArb(3, 4).chain((pairs) =>
      fc.nat().map((i) => ({ pairs, index: i % pairs.length })),
    );

    it('accepts a tie-thread naming a key pair, in either order', () => {
      fc.assert(
        fc.property(mappedArb, fc.boolean(), ({ pairs, index }, swap) => {
          const mapped = mapBoundThreadsPayload('q', pairs)!;
          const [l, r] = mapped.payload.keyPairs[index]!;
          const pair = swap ? [r, l] : [l, r];
          expect(QuestionSpecSchema.safeParse(specOf(mapped.payload, { kind: 'tie-thread', pair })).success).toBe(true);
        }),
      );
    });

    it('rejects a tie-thread pair that is not in keyPairs', () => {
      fc.assert(
        fc.property(mappedArb, ({ pairs, index }) => {
          const mapped = mapBoundThreadsPayload('q', pairs)!;
          // Left of one pair with right of the next: both exist, but they are not a key pair.
          const other = mapped.payload.keyPairs[(index + 1) % pairs.length]![1];
          const hint = { kind: 'tie-thread', pair: [mapped.payload.keyPairs[index]![0], other] };
          expect(QuestionSpecSchema.safeParse(specOf(mapped.payload, hint)).success).toBe(false);
        }),
      );
    });

    it('rejects a payload whose keyPairs are not one-to-one over the ids', () => {
      fc.assert(
        fc.property(mappedArb, ({ pairs, index }) => {
          const { payload } = mapBoundThreadsPayload('q', pairs)!;
          const keyPairs = payload.keyPairs.map((p, k) => (k === (index + 1) % pairs.length ? [payload.keyPairs[index]![0], p[1]] : p));
          expect(QuestionSpecSchema.safeParse(specOf({ ...payload, keyPairs }, null)).success).toBe(false);
        }),
      );
    });

    it('rejects a hint of another lock type', () => {
      fc.assert(
        fc.property(mappedArb, ({ pairs }) => {
          const { payload } = mapBoundThreadsPayload('q', pairs)!;
          expect(QuestionSpecSchema.safeParse(specOf(payload, { kind: 'lock-first-bone', boneId: 'x' })).success).toBe(false);
        }),
      );
    });
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property: keyPairs preserve pairings and authoring order
  // **Validates: Requirements 22.2, 22.8**
  it('mapper: keyPairs keep every pairing in authoring order and the manifest is accepted', () => {
    const base = buildManifest({ lockTypes: ['bound-threads'], rooms: 1, conceptsPerRoom: 1, alternates: false, finalDoorQuestions: 0 });
    fc.assert(
      fc.property(pairsArb(3, 4), (pairs) => {
        const slot = base.rooms[0]!.lockSlots[0]!;
        const { payload, hintEffect } = mapBoundThreadsPayload(slot.primaryQuestion.questionId, pairs)!;
        const leftText = new Map(payload.leftIds.map((id, i) => [id, pairs[i]!.left]));
        const rightText = new Map(payload.rightIds.map((id, i) => [id, pairs[i]!.right]));
        expect(payload.keyPairs.map(([l, r]) => ({ left: leftText.get(l), right: rightText.get(r) }))).toEqual(
          pairs.map((p) => ({ left: p.left, right: p.right })),
        );
        const manifest = {
          ...base,
          rooms: [{ ...base.rooms[0]!, lockSlots: [{ ...slot, primaryQuestion: { ...slot.primaryQuestion, payload, hintEffect } }] }],
        };
        expect(CryptManifestSchema.safeParse(manifest).success).toBe(true);
      }),
    );
  });
});

function contextFor(notes: string): QuoteContext {
  const chunks = chunkDocument({ sourceType: 'paste', text: notes, originalText: notes });
  const map = new Map<string, Chunk>();
  const paragraphChunkIds = new Map<number, string>();
  for (const c of chunks) {
    map.set(c.id, c);
    if (c.location.sourceType === 'paste' && !paragraphChunkIds.has(c.location.paragraphNumber)) {
      paragraphChunkIds.set(c.location.paragraphNumber, c.id);
    }
  }
  return { chunks: map, paragraphChunkIds };
}

interface Fixture {
  id: string;
  expectedCatch: string;
  notes: string;
  notesDir?: string;
  question: Record<string, unknown>;
}

// Feature: generation-and-evaluation, Property 29: Every Dev_Set and Sample_Set question of the four new types passes Code_Checks, and every code:* adversarial fixture of those types fails with exactly its expected Check_ID
// **Validates: Requirements 22.9**
describe('Property 29 (bound-threads part)', () => {
  it('every dev and sample bound-threads question passes Code_Checks', () => {
    let count = 0;
    for (const [qdir, ndir] of [
      ['eval/dev/questions', 'eval/dev/notes'],
      ['samples/questions', 'samples'],
    ] as const) {
      for (const f of fs.readdirSync(`${root}/${qdir}`)) {
        const json = JSON.parse(fs.readFileSync(`${root}/${qdir}/${f}`, 'utf8')) as {
          notes: string;
          questions: Record<string, unknown>[];
        };
        const context = contextFor(fs.readFileSync(`${root}/${ndir}/${json.notes}`, 'utf8'));
        for (const raw of json.questions.filter((q) => q['lockType'] === 'bound-threads')) {
          const parsed = parseAuthoringQuestion(raw);
          expect(parsed.ok, `${f}:${String(raw['id'])} parses`).toBe(true);
          if (!parsed.ok) continue;
          count += 1;
          expect(ids(boundThreadsChecks(parsed.value as BoundThreadsAuthoringQuestion, context)), `${f}:${String(raw['id'])}`).toEqual([]);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('every code:* bound-threads adversarial fixture fails with exactly its expected Check_ID', () => {
    const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as { fixtures: Fixture[] };
    const fixtures = all.fixtures.filter((f) => f.question['lockType'] === 'bound-threads' && f.expectedCatch.startsWith('code:'));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
      const context = contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
      // Raw cast: a fixture may break the schema (for example 5 pairs) so only the check can catch it.
      const got = ids(boundThreadsChecks(f.question as unknown as BoundThreadsAuthoringQuestion, context));
      expect(got, f.id).toEqual([f.expectedCatch.slice('code:'.length)]);
    }
  });
});
