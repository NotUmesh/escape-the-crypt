import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import { chunkDocument } from '../chunker';
import { runChecks } from '../checks/run-checks';
import { CryptManifestSchema, QuestionSpecSchema } from '../runtime/manifest-schema';
import { buildManifest } from '../test-support/manifest-fixture';
import type { Chunk } from '../types';
import { checkItemCount } from './cursed-object-checks';
import { mapCursedObjectPayload } from './cursed-object';

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

const text = fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() !== '');
// Four distinct items plus the index of the odd one.
const itemsArb = fc
  .uniqueArray(text, { minLength: 4, maxLength: 4 })
  .chain((items) => fc.nat({ max: 3 }).map((odd) => ({ items, odd })));

function specOf(payload: unknown, hintEffect: unknown) {
  return { questionId: 'q', lockType: 'cursed-object', payload, evidenceRefs: ['c1'], hintEffect };
}

describe('cursed-object properties', () => {
  // Feature: generation-and-evaluation, Property 22: Count checks reject out-of-range counts and accept in-range counts
  // **Validates: Requirements 22.3**
  it('Property 22: item-count fails exactly when the count is not 4', () => {
    fc.assert(
      fc.property(fc.nat({ max: 8 }), (n) => {
        const items = Array.from({ length: n }, (_, i) => `item${i}`);
        expect(ids(checkItemCount({ id: 'q', items }))).toEqual(n === 4 ? [] : ['item-count']);
      }),
    );
  });

  // Feature: generation-and-evaluation, Property 28: The Manifest_Schema validates every six-Lock_Type payload and hint shape, and rejects every mismatch
  // **Validates: Requirements 22.8**
  describe('Property 28 (cursed-object part)', () => {
    it('accepts the mapped payload with a hint that removes a non-odd item', () => {
      fc.assert(
        fc.property(itemsArb, ({ items, odd }) => {
          const m = mapCursedObjectPayload('q', items, items[odd]!)!;
          expect(QuestionSpecSchema.safeParse(specOf(m.payload, m.hintEffect)).success).toBe(true);
        }),
      );
    });

    it('rejects a hint that removes the odd item', () => {
      fc.assert(
        fc.property(itemsArb, ({ items, odd }) => {
          const { payload } = mapCursedObjectPayload('q', items, items[odd]!)!;
          const hint = { kind: 'remove-option', optionId: payload.oddOneOutId };
          expect(QuestionSpecSchema.safeParse(specOf(payload, hint)).success).toBe(false);
        }),
      );
    });

    it('rejects a hint that removes an id outside optionIds', () => {
      fc.assert(
        fc.property(itemsArb, ({ items, odd }) => {
          const { payload } = mapCursedObjectPayload('q', items, items[odd]!)!;
          const hint = { kind: 'remove-option', optionId: 'not-an-option' };
          expect(QuestionSpecSchema.safeParse(specOf(payload, hint)).success).toBe(false);
        }),
      );
    });

    it('rejects an oddOneOutId that is not in optionIds', () => {
      fc.assert(
        fc.property(itemsArb, ({ items, odd }) => {
          const m = mapCursedObjectPayload('q', items, items[odd]!)!;
          const payload = { ...m.payload, oddOneOutId: 'ghost' };
          expect(QuestionSpecSchema.safeParse(specOf(payload, m.hintEffect)).success).toBe(false);
        }),
      );
    });

    it('rejects a hint of another lock type', () => {
      fc.assert(
        fc.property(itemsArb, ({ items, odd }) => {
          const { payload } = mapCursedObjectPayload('q', items, items[odd]!)!;
          const hint = { kind: 'lock-first-bone', boneId: 'x' };
          expect(QuestionSpecSchema.safeParse(specOf(payload, hint)).success).toBe(false);
        }),
      );
    });

    it('rejects an optionIds list that is not exactly four', () => {
      fc.assert(
        fc.property(itemsArb, ({ items, odd }) => {
          const m = mapCursedObjectPayload('q', items, items[odd]!)!;
          const payload = { ...m.payload, optionIds: m.payload.optionIds.slice(0, 3) };
          expect(QuestionSpecSchema.safeParse(specOf(payload, null)).success).toBe(false);
        }),
      );
    });
  });

  // Feature: generation-and-evaluation, Phase 5 mapper property: option order and the odd item are preserved
  // **Validates: Requirements 22.3, 22.8**
  it('mapper: optionIds keep item order, oddOneOutId names the answer, and the manifest is accepted', () => {
    const base = buildManifest({ lockTypes: ['cursed-object'], rooms: 1, conceptsPerRoom: 1, alternates: false, finalDoorQuestions: 0 });
    fc.assert(
      fc.property(itemsArb, ({ items, odd }) => {
        const slot = base.rooms[0]!.lockSlots[0]!;
        const { payload, hintEffect } = mapCursedObjectPayload(slot.primaryQuestion.questionId, items, items[odd]!)!;
        expect(payload.optionIds).toHaveLength(4);
        expect(payload.optionIds.indexOf(payload.oddOneOutId)).toBe(odd);
        expect(payload.optionIds.map((id) => Number(id.slice(id.lastIndexOf('-') + 1)))).toEqual([0, 1, 2, 3]);
        expect(hintEffect.optionId).not.toBe(payload.oddOneOutId);
        const manifest = {
          ...base,
          rooms: [{ ...base.rooms[0]!, lockSlots: [{ ...slot, primaryQuestion: { ...slot.primaryQuestion, payload, hintEffect } }] }],
        };
        expect(CryptManifestSchema.safeParse(manifest).success).toBe(true);
      }),
    );
  });
});

function contextFor(notes: string) {
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
describe('Property 29 (cursed-object part)', () => {
  it('every dev and sample cursed-object question passes Code_Checks', () => {
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
        for (const raw of json.questions.filter((q) => q['lockType'] === 'cursed-object')) {
          const parsed = parseAuthoringQuestion(raw);
          expect(parsed.ok, `${f}:${String(raw['id'])} parses`).toBe(true);
          if (!parsed.ok) continue;
          count += 1;
          expect(ids(runChecks({ question: parsed.value, ...context })), `${f}:${String(raw['id'])}`).toEqual([]);
        }
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('every code:* cursed-object adversarial fixture fails with exactly its expected Check_ID', () => {
    const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as { fixtures: Fixture[] };
    const fixtures = all.fixtures.filter((f) => f.question['lockType'] === 'cursed-object' && f.expectedCatch.startsWith('code:'));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const f of fixtures) {
      const dir = f.notesDir === 'adversarial/notes' ? 'eval/adversarial/notes' : f.notesDir === 'samples' ? 'samples' : 'eval/dev/notes';
      const context = contextFor(fs.readFileSync(`${root}/${dir}/${f.notes}`, 'utf8'));
      // Raw cast: a fixture may break the schema (for example 5 items) so only the check can catch it.
      const question = f.question as unknown as Parameters<typeof runChecks>[0]['question'];
      expect(ids(runChecks({ question, ...context })), f.id).toEqual([f.expectedCatch.slice('code:'.length)]);
    }
  });

  it('the review-stage fixture adv-20 passes the code stage', () => {
    const all = JSON.parse(fs.readFileSync(`${root}/eval/adversarial/fixtures.json`, 'utf8')) as { fixtures: Fixture[] };
    const f = all.fixtures.find((x) => x.id === 'adv-20')!;
    const context = contextFor(fs.readFileSync(`${root}/eval/dev/notes/${f.notes}`, 'utf8'));
    const question = f.question as unknown as Parameters<typeof runChecks>[0]['question'];
    expect(ids(runChecks({ question, ...context }))).toEqual([]);
  });
});
