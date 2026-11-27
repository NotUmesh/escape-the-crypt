import fc from 'fast-check';
import type { CryptContent, CryptManifest } from '@escape-the-crypt/core';
import { cryptContentEntryArb } from '../../../../../packages/core/src/test-support/crypt-content-arbitraries';
import { buildManifest } from '../../../../../packages/core/src/test-support/manifest-fixture';
import { playAccepted, runSettingsArb } from './persistence-arbitraries';
import type { AcceptedRun } from './persistence-arbitraries';

/**
 * `acceptedRunArb` over manifests that `saveCrypt` accepts. A stored crypt is re-validated on
 * load, and the manifest schema currently admits only rune-cipher and séance-board questions,
 * so `manifestArb` (all six types) would almost never persist. Same shape otherwise.
 */
export const persistableRunArb: fc.Arbitrary<AcceptedRun> = fc
  .record({
    rooms: fc.integer({ min: 1, max: 5 }),
    conceptsPerRoom: fc.integer({ min: 1, max: 6 }),
    alternateMask: fc.array(fc.boolean(), { minLength: 30, maxLength: 30 }),
    hintEffects: fc.boolean(),
    finalDoorQuestions: fc.integer({ min: 0, max: 4 }),
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  })
  .map(({ alternateMask, ...rest }) =>
    buildManifest({
      ...rest,
      lockTypes: ['rune-cipher', 'seance-board'],
      alternates: (roomIndex, conceptIndex) => alternateMask[roomIndex * 6 + conceptIndex] ?? true,
    }),
  )
  .chain((manifest) =>
    fc
      .tuple(runSettingsArb, fc.array(fc.nat({ max: 1000 }), { maxLength: 30 }))
      .map(([settings, choices]) => playAccepted(manifest, settings, choices)),
  );

function questionIds(manifest: CryptManifest): string[] {
  const ids: string[] = [];
  for (const room of manifest.rooms) {
    for (const slot of room.lockSlots) {
      ids.push(slot.primaryQuestion.questionId);
      if (slot.alternateQuestion !== null) ids.push(slot.alternateQuestion.questionId);
    }
  }
  for (const slot of manifest.finalDoor.slots) ids.push(slot.question.questionId);
  return ids;
}

function conceptIds(manifest: CryptManifest): string[] {
  const ids = new Set<string>();
  for (const room of manifest.rooms) for (const slot of room.lockSlots) ids.add(slot.conceptId);
  for (const slot of manifest.finalDoor.slots) ids.add(slot.conceptId);
  return [...ids];
}

/** Content covering every question and concept the manifest names. */
export function contentArb(manifest: CryptManifest): fc.Arbitrary<CryptContent> {
  const qIds = [...new Set(questionIds(manifest))];
  const cIds = conceptIds(manifest);
  return fc
    .tuple(
      fc.array(cryptContentEntryArb, { minLength: qIds.length, maxLength: qIds.length }),
      fc.array(fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,30}[A-Za-z]$/), { minLength: cIds.length, maxLength: cIds.length }),
    )
    .map(([entries, titles]) => ({
      questions: Object.fromEntries(qIds.map((id, i) => [id, entries[i]!])),
      concepts: Object.fromEntries(cIds.map((id, i) => [id, { title: titles[i]! }])),
    }));
}
