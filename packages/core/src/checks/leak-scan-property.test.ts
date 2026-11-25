import fc from 'fast-check';
import { describe, it } from 'vitest';
import { leakScanRoom, type LeakScanRoomEntry } from './leak-scan';

// Feature: generation-and-evaluation, Property 10: Leak_Scan finds no cross-concept rune leak unless one is injected
// **Validates: Requirements 24.4**

interface RuneStub {
  readonly id: string;
  readonly lockType: 'rune-cipher';
  readonly answer: string;
  readonly caseSensitive: boolean;
}

interface Room {
  readonly answers: readonly string[];
  readonly caseSensitive: boolean;
}

// The "zq" prefix keeps every answer out of the fixed filler words below.
const answerArb = fc.stringMatching(/^[a-z]{5,9}$/).map((s) => `zq${s}`);

const roomArb: fc.Arbitrary<Room> = fc.record({
  answers: fc.uniqueArray(answerArb, { minLength: 2, maxLength: 6 }),
  caseSensitive: fc.boolean(),
});

/** One rune question and one séance question per concept; each shows only its own answer. */
function buildRoom(
  room: Room,
  extraSeanceText: ReadonlyMap<number, string>,
): readonly LeakScanRoomEntry[] {
  const entries: LeakScanRoomEntry[] = [];
  room.answers.forEach((answer, i) => {
    const rune: RuneStub = {
      id: `rune-${i}`,
      lockType: 'rune-cipher',
      answer,
      caseSensitive: room.caseSensitive,
    };
    entries.push({
      conceptId: `concept-${i}`,
      question: rune,
      visibleText: [`According to your notes, the term ____ names concept number ${i}.`],
    });
    const extra = extraSeanceText.get(i);
    entries.push({
      conceptId: `concept-${i}`,
      question: { id: `seance-${i}`, lockType: 'seance-board' },
      visibleText: [
        `According to your notes, which statement holds? ${answer} is its own concept.`,
        ...(extra === undefined ? [] : [`It also relates to ${extra}.`]),
      ],
    });
  });
  return entries;
}

describe('Property 10: Leak_Scan cross-concept rune leak', () => {
  it('reports nothing when no answer appears in another concept', () => {
    fc.assert(
      fc.property(roomArb, (room) => {
        return leakScanRoom(buildRoom(room, new Map())).length === 0;
      }),
      { numRuns: 100 },
    );
  });

  it('reports exactly the injected answer-leak-in-room for the right question', () => {
    fc.assert(
      fc.property(
        roomArb,
        fc.nat(),
        fc.nat(),
        (room, a, b) => {
          const n = room.answers.length;
          const source = a % n;
          const target = (source + 1 + (b % (n - 1))) % n;
          const answer = room.answers[source] ?? '';
          const leaked = room.caseSensitive ? answer : answer.toUpperCase();
          const failures = leakScanRoom(buildRoom(room, new Map([[target, leaked]])));
          return (
            failures.length === 1 &&
            failures[0]?.checkId === 'answer-leak-in-room' &&
            failures[0]?.questionId === `rune-${source}`
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
