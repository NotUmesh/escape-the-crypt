import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../test-support/manifest-fixture';
import type { BuildManifestOptions } from '../test-support/manifest-fixture';
import type { LockType } from '../types';
import type { QuestionSpec } from './manifest-types';
import { parseManifest } from './manifest-schema';

const PHASE_ONE_TYPES: readonly LockType[] = ['rune-cipher', 'seance-board'];

const optionsArb: fc.Arbitrary<BuildManifestOptions> = fc.record({
  manifestId: fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
  rooms: fc.integer({ min: 1, max: 5 }),
  conceptsPerRoom: fc.integer({ min: 1, max: 2 }),
  alternates: fc.boolean(),
  hintEffects: fc.boolean(),
  finalDoorQuestions: fc.integer({ min: 0, max: 4 }),
  seed: fc.option(fc.integer({ min: 0, max: 2 ** 31 }), { nil: undefined }),
  lockTypes: fc.constantFrom<readonly LockType[]>(
    PHASE_ONE_TYPES,
    [...PHASE_ONE_TYPES].reverse(),
    ['rune-cipher'],
    ['seance-board'],
  ),
});

function allQuestions(manifest: ReturnType<typeof buildManifest>): QuestionSpec[] {
  const out: QuestionSpec[] = [];
  for (const room of manifest.rooms) {
    for (const slot of room.lockSlots) {
      out.push(slot.primaryQuestion);
      if (slot.alternateQuestion !== null) out.push(slot.alternateQuestion);
    }
  }
  for (const slot of manifest.finalDoor.slots) out.push(slot.question);
  return out;
}

describe('manifest serialisation round-trip', () => {
  // Feature: generation-and-evaluation, Property 2: Manifest round-trip
  // **Validates: Requirements 2.11, 2.19**
  it('JSON.stringify then parseManifest yields an equal manifest', () => {
    fc.assert(
      fc.property(optionsArb, (options) => {
        const original = buildManifest(options);
        const result = parseManifest(JSON.parse(JSON.stringify(original)));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual(original);

        const before = allQuestions(original);
        const after = allQuestions(result.value);
        expect(after.map((q) => q.hintEffect)).toEqual(before.map((q) => q.hintEffect));
        expect(after.map((q) => (q.payload as { optionIds?: unknown }).optionIds)).toEqual(
          before.map((q) => (q.payload as { optionIds?: unknown }).optionIds),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('keeps reveal-first-letter hints on rune cipher questions', () => {
    const original = buildManifest({ lockTypes: ['rune-cipher'], hintEffects: true });
    const result = parseManifest(JSON.parse(JSON.stringify(original)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = allQuestions(result.value).map((q) => q.hintEffect?.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(new Set(kinds)).toEqual(new Set(['reveal-first-letter']));
  });
});
