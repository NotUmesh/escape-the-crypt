import { describe, expect, it } from 'vitest';
import { ROOM_ANNOUNCEMENT_COPY } from '@escape-the-crypt/core';
import type { Outcome_Notice, State } from '@escape-the-crypt/core';
import { EMPTY_TRACKER, announceStep } from './announce-step';

function stateWith(status: 'open' | 'solved', evidence: boolean): State {
  const slot = {
    slotId: 's1',
    status,
    candleLit: status === 'solved',
    evidencePanelOpen: evidence,
    judgedResult: status === 'solved' ? 'correct' : null,
  };
  return { rooms: [{ lockSlots: [slot], dueReturnSlots: [] }], finalDoor: { slots: [] } } as unknown as State;
}
const before = stateWith('open', false);
const after = stateWith('solved', true);
const lit: readonly Outcome_Notice[] = [{ kind: 'candleLit', target: { type: 'slot', slotId: 's1' } }];

describe('announceStep', () => {
  it('announces nothing for the first State', () => {
    expect(announceStep(EMPTY_TRACKER, before, []).messages).toEqual([]);
  });
  it('announces notices that arrive with the State', () => {
    const first = announceStep(EMPTY_TRACKER, before, []);
    const step = announceStep(first.tracker, after, lit);
    expect(step.messages).toContain(ROOM_ANNOUNCEMENT_COPY.notice.candleLit);
  });
  it('announces notices that arrive one render after the State, once (the saved-run flow)', () => {
    const first = announceStep(EMPTY_TRACKER, before, []);
    const stateOnly = announceStep(first.tracker, after, []);
    expect(stateOnly.messages).not.toContain(ROOM_ANNOUNCEMENT_COPY.notice.candleLit);
    const late = announceStep(stateOnly.tracker, after, lit);
    expect(late.messages).toEqual([ROOM_ANNOUNCEMENT_COPY.notice.candleLit]);
    expect(announceStep(late.tracker, after, lit).messages).toEqual([]);
  });
  it('announces nothing for a rejected dispatch (same State, no notices)', () => {
    const first = announceStep(EMPTY_TRACKER, before, []);
    expect(announceStep(first.tracker, before, []).messages).toEqual([]);
  });
  it('forgets the run when the State goes away', () => {
    expect(announceStep(announceStep(EMPTY_TRACKER, before, []).tracker, null, []).tracker).toBe(EMPTY_TRACKER);
  });
});
