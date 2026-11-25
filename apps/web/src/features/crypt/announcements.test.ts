import { describe, expect, it } from 'vitest';
import { ROOM_ANNOUNCEMENT_COPY } from '@escape-the-crypt/core';
import type {
  FinalDoorSlotState,
  LockSlotState,
  Outcome_Notice,
  ReturnSlotState,
  SlotStatus,
  State,
} from '@escape-the-crypt/core';

import { announcementsFor } from './announcements';

const lock = (over: Partial<LockSlotState> = {}): LockSlotState => ({
  slotId: 'r1-l1',
  stationType: 'rune-cipher',
  currentQuestionId: 'q1',
  currentQuestionType: 'rune-cipher',
  status: 'open',
  candleLit: false,
  appliedHint: null,
  evidencePanelOpen: false,
  judgedResult: null,
  ...over,
});

const ret = (over: Partial<ReturnSlotState> = {}): ReturnSlotState => ({
  slotId: 'ret-1',
  conceptId: 'c1',
  returnNumber: 1,
  currentQuestionId: 'q2',
  currentQuestionType: 'rune-cipher',
  label: null,
  status: 'open',
  candleLit: false,
  appliedHint: null,
  evidencePanelOpen: false,
  ...over,
});

const door = (over: Partial<FinalDoorSlotState> = {}): FinalDoorSlotState => ({
  slotId: 'door-1',
  origin: 'reserved',
  conceptId: 'c1',
  returnNumber: null,
  currentQuestionId: 'q3',
  currentQuestionType: 'rune-cipher',
  label: null,
  status: 'open',
  candleLit: false,
  appliedHint: null,
  evidencePanelOpen: false,
  ...over,
});

interface Slots {
  readonly locks?: readonly LockSlotState[];
  readonly returns?: readonly ReturnSlotState[];
  readonly doors?: readonly FinalDoorSlotState[];
}

/** A minimal State: only the fields `announcementsFor` reads are meaningful. */
const stateOf = ({ locks = [], returns = [], doors = [] }: Slots): State =>
  ({
    rooms: [{ roomId: 'r1', published: true, cleared: false, lockSlots: locks, dueReturnSlots: returns, spiritCandles: [] }],
    finalDoor: { available: true, slots: doors, spiritCandles: [] },
  }) as unknown as State;

const notices: ReadonlyArray<readonly [Outcome_Notice]> = [
  [{ kind: 'candleLit', target: { type: 'slot', slotId: 'r1-l1' } }],
  [{ kind: 'ghostSpawned', conceptId: 'c1' }],
  [{ kind: 'ghostLaidToRest', conceptId: 'c1' }],
  [{ kind: 'sealCracked', slotId: 'r1-l1' }],
  [{ kind: 'roomCleared', roomId: 'r1' }],
  [{ kind: 'escaped' }],
];

const copyEntries = new Set<string>([
  ...Object.values(ROOM_ANNOUNCEMENT_COPY.notice),
  ...Object.values(ROOM_ANNOUNCEMENT_COPY.status),
  ...Object.values(ROOM_ANNOUNCEMENT_COPY.evidence),
]);

const changed: readonly Exclude<SlotStatus, 'open'>[] = ['solved', 'settled', 'challenged'];

describe('announcementsFor', () => {
  it.each(notices)('announces notice %j from copy', (notice) => {
    const state = stateOf({ locks: [lock()] });
    expect(announcementsFor(state, state, [notice])).toEqual([ROOM_ANNOUNCEMENT_COPY.notice[notice.kind]]);
  });

  it('gives no messages for an unchanged State with no notices', () => {
    const state = stateOf({ locks: [lock()], returns: [ret()], doors: [door()] });
    expect(announcementsFor(state, state, [])).toEqual([]);
  });

  describe.each(changed)('open to %s', (status) => {
    const expected = [ROOM_ANNOUNCEMENT_COPY.status[status]];

    it('on a Lock_Slot', () => {
      expect(announcementsFor(stateOf({ locks: [lock()] }), stateOf({ locks: [lock({ status })] }), [])).toEqual(expected);
    });

    it('on a Return_Slot', () => {
      expect(announcementsFor(stateOf({ returns: [ret()] }), stateOf({ returns: [ret({ status })] }), [])).toEqual(expected);
    });

    it.each(['reserved', 'return'] as const)('on a Final_Door slot with origin %s', (origin) => {
      expect(
        announcementsFor(stateOf({ doors: [door({ origin })] }), stateOf({ doors: [door({ origin, status })] }), []),
      ).toEqual(expected);
    });
  });

  it('does not announce a status that was already settled', () => {
    const before = stateOf({ locks: [lock({ status: 'solved' })] });
    expect(announcementsFor(before, before, [])).toEqual([]);
  });

  describe('Evidence_Panel opening', () => {
    it('announces a correct result', () => {
      const next = stateOf({ locks: [lock({ evidencePanelOpen: true, judgedResult: 'correct', status: 'solved' })] });
      expect(announcementsFor(stateOf({ locks: [lock()] }), next, [])[0]).toBe(ROOM_ANNOUNCEMENT_COPY.evidence.correct);
    });

    it('announces a not-correct result', () => {
      const next = stateOf({ locks: [lock({ evidencePanelOpen: true, judgedResult: 'wrong', status: 'settled' })] });
      expect(announcementsFor(stateOf({ locks: [lock()] }), next, [])[0]).toBe(ROOM_ANNOUNCEMENT_COPY.evidence.wrong);
    });

    it('announces nothing for a panel that was already open', () => {
      const open = stateOf({ locks: [lock({ evidencePanelOpen: true, judgedResult: 'wrong', status: 'settled' })] });
      expect(announcementsFor(open, open, [])).toEqual([]);
    });

    it('announces nothing when the opened panel has no result', () => {
      const next = stateOf({ locks: [lock({ evidencePanelOpen: true, status: 'challenged' })] });
      expect(announcementsFor(stateOf({ locks: [lock()] }), next, [])).toEqual([ROOM_ANNOUNCEMENT_COPY.status.challenged]);
    });
  });

  it('orders evidence result, then status, then notices, and uses only copy entries', () => {
    const before = stateOf({ locks: [lock()] });
    const after = stateOf({ locks: [lock({ status: 'solved', candleLit: true, evidencePanelOpen: true, judgedResult: 'correct' })] });
    const result = announcementsFor(before, after, [
      { kind: 'candleLit', target: { type: 'slot', slotId: 'r1-l1' } },
      { kind: 'roomCleared', roomId: 'r1' },
    ]);
    expect(result).toEqual([
      ROOM_ANNOUNCEMENT_COPY.evidence.correct,
      ROOM_ANNOUNCEMENT_COPY.status.solved,
      ROOM_ANNOUNCEMENT_COPY.notice.candleLit,
      ROOM_ANNOUNCEMENT_COPY.notice.roomCleared,
    ]);
    for (const message of result) expect(copyEntries.has(message)).toBe(true);
  });
});
