import { describe, expect, it } from 'vitest';
import type { FinalDoorSlotState, LockSlotState, ReturnSlotState, SlotStatus } from '@escape-the-crypt/core';

import { evidenceResult } from './evidence-text';
import type { EvidenceResult } from './evidence-text';

const lockSlot = (judgedResult: LockSlotState['judgedResult'], status: SlotStatus = 'settled'): LockSlotState => ({
  slotId: 'r1-l1',
  stationType: 'rune-cipher',
  currentQuestionId: 'q1',
  currentQuestionType: 'rune-cipher',
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
  judgedResult,
});

const returnSlot = (status: SlotStatus): ReturnSlotState => ({
  slotId: 'ret-1',
  conceptId: 'c1',
  returnNumber: 1,
  currentQuestionId: 'q2',
  currentQuestionType: 'rune-cipher',
  label: 'review',
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
});

const doorSlot = (origin: FinalDoorSlotState['origin'], status: SlotStatus): FinalDoorSlotState => ({
  slotId: 'door-1',
  origin,
  conceptId: 'c1',
  returnNumber: origin === 'return' ? 1 : null,
  currentQuestionId: 'q3',
  currentQuestionType: 'rune-cipher',
  label: origin === 'return' ? 'review' : null,
  status,
  candleLit: status === 'solved',
  appliedHint: null,
  evidencePanelOpen: true,
});

describe('evidenceResult', () => {
  it.each<[string, LockSlotState, EvidenceResult]>([
    ['judgedResult correct', lockSlot('correct', 'solved'), 'correct'],
    ['judgedResult wrong', lockSlot('wrong'), 'wrong'],
    ['judgedResult invalid', lockSlot('invalid', 'open'), null],
    ['judgedResult null', lockSlot(null, 'open'), null],
  ])('Lock_Slot with %s', (_name, slot, expected) => {
    expect(evidenceResult(slot)).toBe(expected);
  });

  const byStatus: ReadonlyArray<[SlotStatus, EvidenceResult]> = [
    ['solved', 'correct'],
    ['settled', 'wrong'],
    ['challenged', null],
    ['open', null],
  ];

  it.each(byStatus)('Return_Slot with status %s', (status, expected) => {
    expect(evidenceResult(returnSlot(status))).toBe(expected);
  });

  it.each(
    (['reserved', 'return'] as const).flatMap((origin) =>
      byStatus.map(([status, expected]) => [origin, status, expected] as const),
    ),
  )('Final_Door slot, origin %s, status %s', (origin, status, expected) => {
    expect(evidenceResult(doorSlot(origin, status))).toBe(expected);
  });
});
