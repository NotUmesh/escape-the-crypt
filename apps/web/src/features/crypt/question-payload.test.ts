import { describe, expect, it } from 'vitest';
import type { State } from '@escape-the-crypt/core';
import { buildManifest } from '../../../../../packages/core/src/test-support/manifest-fixture';
import { payloadOfQuestion } from './question-payload';

const manifest = buildManifest({ rooms: 2, conceptsPerRoom: 6, alternates: true, finalDoorQuestions: 2 });
const state = { manifest } as unknown as State;

describe('payloadOfQuestion', () => {
  it('returns the payload of every primary and alternate question', () => {
    let seen = 0;
    for (const room of manifest.rooms) {
      for (const spec of room.lockSlots) {
        for (const q of [spec.primaryQuestion, spec.alternateQuestion]) {
          if (q === null) continue;
          expect(payloadOfQuestion(state, q.questionId)).toBe(q.payload);
          seen += 1;
        }
      }
    }
    expect(seen).toBeGreaterThan(6);
  });
  it('returns the payload of a final-door question', () => {
    const door = manifest.finalDoor.slots[0];
    expect(door).toBeDefined();
    if (door !== undefined) expect(payloadOfQuestion(state, door.question.questionId)).toBe(door.question.payload);
  });
  it('returns null for an unknown question', () => {
    expect(payloadOfQuestion(state, 'nope')).toBeNull();
  });
});
