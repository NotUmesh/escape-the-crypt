import type { State } from '@escape-the-crypt/core';

/**
 * The manifest payload of a question, whether it is a primary, an alternate or a final-door
 * question. Null when the manifest has no such question. Read-only.
 */
export function payloadOfQuestion(state: State, questionId: string): unknown {
  for (const room of state.manifest.rooms) {
    for (const spec of room.lockSlots) {
      for (const q of [spec.primaryQuestion, spec.alternateQuestion]) {
        if (q !== null && q.questionId === questionId) return q.payload;
      }
    }
  }
  for (const door of state.manifest.finalDoor.slots) {
    if (door.question.questionId === questionId) return door.question.payload;
  }
  return null;
}
