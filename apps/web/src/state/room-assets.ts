import type { Chunk, CryptContent, CryptManifest } from '@escape-the-crypt/core';

/** Where a crypt's questions come from: the bundled sample, or the learner's own notes. */
export type CryptSource = 'sample' | 'notes';

/** Read-only run assets, built once at crypt-build time and held unchanged for the run. */
export interface RoomAssets {
  /** 'notes' for a generated crypt; it picks citation wording and the review label. */
  readonly source: CryptSource;
  readonly content: CryptContent;
  readonly chunks: ReadonlyMap<string, Chunk>;
  /** conceptId -> the question of the concept's first Lock_Slot, in manifest order. */
  readonly firstQuestionByConcept: Readonly<Record<string, string>>;
}

/**
 * Walks each Lock_Slot's primary question in manifest order and keeps the first Question_Id
 * seen per conceptId. Alternates and reserved final-door questions are never returned.
 * A reserved final-door question is used only for a concept that has no Lock_Slot at all
 * (it is then that concept's only question), so every conceptId of the manifest has an entry.
 * It never replaces a Lock_Slot primary, and Alternates are never used.
 */
export function buildFirstQuestionByConcept(manifest: CryptManifest): Readonly<Record<string, string>> {
  const result = new Map<string, string>();
  for (const room of manifest.rooms) {
    for (const slot of room.lockSlots) {
      if (!result.has(slot.conceptId)) result.set(slot.conceptId, slot.primaryQuestion.questionId);
    }
  }
  for (const slot of manifest.finalDoor.slots) {
    if (!result.has(slot.conceptId)) result.set(slot.conceptId, slot.question.questionId);
  }
  return Object.fromEntries(result);
}
