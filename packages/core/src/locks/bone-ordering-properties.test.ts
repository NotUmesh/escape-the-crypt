import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { BoneOrderingAuthoringQuestion } from '../authoring/schema';
import { chunkDocument } from '../chunker';
import type { QuoteContext } from '../checks/evidence';
import { CryptManifestSchema, QuestionSpecSchema } from '../runtime/manifest-schema';
import { buildManifest } from '../test-support/manifest-fixture';
import type { Chunk } from '../types';
import { mapBoneOrderingPayload } from './bone-ordering';
import { boneOrderingChecks, checkStepCount } from './bone-ordering-checks';

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

function specOf(questionId: string, payload: unknown, hintEffect: unknown) {
  return { questionId, lockType: 'bone-ordering', payload, evidenceRefs: ['c1'], hintEffect };
}

describe('bone-ordering properties', () => {
  // Feature: generation-and-evaluation, Property 22: Count checks reject out-of-range counts and accept in-range counts
  // **Validates: Requirements 22.1**
  it('Property 22: step-count fails exactly when the count is outside 3 to 5', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { maxLength: 9 }), (steps) => {
        const inRange = steps.length >= 3 && steps.length <= 5;
        expect(ids(checkStepCount({ id: 'q', steps }))).toEqual(inRange ? [] : ['step-count']);
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch
  // **Validates: Requirements 22.8**
  describe('Property 28 (bone-ordering part)', () => {
    const itemsArb = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 3, maxLength: 5 });
    const permutedArb = itemsArb.chain((itemIds) =>
      fc.record({ itemIds: fc.constant(itemIds), keyOrder: fc.shuffledSubarray(itemIds, { minLength: itemIds.length, maxLength: itemIds.length }) }),
    );

    it('accepts a keyOrder that is a permutation and a hint naming an existing item', () => {
      fc.assert(
        fc.property(permutedArb, fc.nat(), ({ itemIds, keyOrder }, i) => {
          const hint = { kind: 'lock-first-bone', boneId: itemIds[i % itemIds.length] };
          expect(QuestionSpecSchema.safeParse(specOf('q', { itemIds, keyOrder }, hint)).success).toBe(true);
        }),
      );
    });

    it('rejects a keyOrder that is not a permutation of itemIds', () => {
      fc.assert(
        fc.property(permutedArb, fc.nat(), fc.boolean(), ({ itemIds, keyOrder }, i, duplicate) => {
          const at = i % keyOrder.length;
          const bad = [...keyOrder];
          bad[at] = duplicate ? bad[(at + 1) % bad.length]! : `${itemIds.join('')}-unknown`;
          expect(QuestionSpecSchema.safeParse(specOf('q', { itemIds, keyOrder: bad }, null)).success).toBe(false);
        }),
      );
    });

    it('rejects a lock-first-bone hint naming an item outside itemIds', () => {
      fc.assert(
        fc.property(permutedArb, ({ itemIds, keyOrder }) => {
          const hint = { kind: 'lock-first-bone', boneId: `${itemIds.join('')}-unknown` };
          expect(QuestionSpecSchema.safeParse(specOf('q', { itemIds, keyOrder }, hint)).success).toBe(false);
        }),
      );
    });
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property: keyOrder preserves step order
  // **Validates: Requirements 22.1, 22.8**
  it('mapper: keyOrder maps back to the step order and the manifest is accepted', () => {
    const base = buildManifest({ lockTypes: ['bone-ordering'], rooms: 1, conceptsPerRoom: 1, alternates: false, finalDoorQuestions: 0 });
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 3, maxLength: 5 }), (steps) => {
        const slot = base.rooms[0]!.lockSlots[0]!;
        const { payload, hintEffect } = mapBoneOrderingPayload(slot.primaryQuestion.questionId, steps);
        const textOf = new Map(payload.itemIds.map((id, i) => [id, steps[i]!]));
        expect(payload.keyOrder.map((id) => textOf.get(id))).toEqual(steps);
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
describe('Property 29 (bone-ordering part)', () => {
  it('every dev and sample bone-ordering question passes Code_Checks', () => {
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
        for (const raw of json.questions.filter((q) => q['lockType'] === 'bone-ordering')) {
          const parsed = parseAuthoringQuestion(raw);
          expect(parsed.ok, `${f}:${String(raw['id'])} parses`).toBe(true);
          if (!parsed.ok) continue;
          count += 1;
          expect(ids(boneOrderingChecks(parsed.value as BoneOrderingAuthoringQuestion, context)), `${f}:${String(raw['id'])}`).toEqual([]);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('every code:* bone-ordering adversarial fixture fails with exactly its expected Check_ID', () => {
    const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as { fixtures: Fixture[] };
    const fixtures = all.fixtures.filter((f) => f.question['lockType'] === 'bone-ordering' && f.expectedCatch.startsWith('code:'));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
      const context = contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
      // Raw cast: a fixture may break the schema (for example 6 steps) so only the check can catch it.
      const got = ids(boneOrderingChecks(f.question as unknown as BoneOrderingAuthoringQuestion, context));
      expect(got, f.id).toEqual([f.expectedCatch.slice('code:'.length)]);
    }
  });
});
