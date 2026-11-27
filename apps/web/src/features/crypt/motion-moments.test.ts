import { describe, expect, it } from 'vitest';
import type { Outcome_Notice, State } from '@escape-the-crypt/core';
import { announcementKeyFor, momentsForStage, selectMotionMoments } from './motion-moments';

type Slot = { slotId: string; candleLit: boolean };
function stateOf(opts: { lit?: string[]; ghosts?: string[]; spirits?: number } = {}): State {
  const slots: Slot[] = (opts.lit ?? []).map((slotId) => ({ slotId, candleLit: true }));
  return {
    rooms: [
      {
        lockSlots: slots,
        dueReturnSlots: [],
        spiritCandles: Array.from({ length: opts.spirits ?? 0 }, (_, i) => ({ conceptId: `c${i}`, returnSlotId: `r${i}` })),
      },
    ],
    finalDoor: { slots: [], spiritCandles: [] },
    ghosts: (opts.ghosts ?? []).map((conceptId) => ({ conceptId, returnNumber: 1, judgedAnswerCountAtSpawn: 0, due: false })),
  } as unknown as State;
}
const BEFORE = stateOf();
const slotLit: Outcome_Notice = { kind: 'candleLit', target: { type: 'slot', slotId: 's1' } };
const spiritLit: Outcome_Notice = { kind: 'candleLit', target: { type: 'spirit', roomId: 'r1' } };
const spawned: Outcome_Notice = { kind: 'ghostSpawned', conceptId: 'c1' };
const rested: Outcome_Notice = { kind: 'ghostLaidToRest', conceptId: 'c1' };

describe('selectMotionMoments', () => {
  it('lights a slot candle the next State shows lit', () => {
    expect(selectMotionMoments(BEFORE, stateOf({ lit: ['s1'] }), [slotLit])).toEqual([
      { kind: 'candle-lit', target: { type: 'slot', slotId: 's1' } },
    ]);
  });
  it('lights a spirit candle only when the spirit count went up', () => {
    expect(selectMotionMoments(BEFORE, stateOf({ spirits: 1 }), [spiritLit])).toEqual([
      { kind: 'candle-lit', target: { type: 'spirit' } },
    ]);
    expect(selectMotionMoments(BEFORE, stateOf(), [spiritLit])).toEqual([]);
  });
  it('raises a ghost the next State holds', () => {
    expect(selectMotionMoments(BEFORE, stateOf({ ghosts: ['c1'] }), [spawned])).toEqual([
      { kind: 'ghost-rises', conceptId: 'c1' },
    ]);
  });
  it('lays a ghost to rest only when the next State holds none for the concept', () => {
    expect(selectMotionMoments(BEFORE, stateOf(), [rested])).toEqual([{ kind: 'ghost-laid-to-rest', conceptId: 'c1' }]);
    expect(selectMotionMoments(BEFORE, stateOf({ ghosts: ['c1'] }), [rested])).toEqual([]);
  });
  it('drops a notice the State does not agree with', () => {
    expect(selectMotionMoments(BEFORE, stateOf(), [slotLit, spawned])).toEqual([]);
  });
  it('gives nothing for no notices or a restored run', () => {
    expect(selectMotionMoments(BEFORE, stateOf({ lit: ['s1'] }), [])).toEqual([]);
    expect(selectMotionMoments(null, stateOf({ lit: ['s1'] }), [slotLit])).toEqual([]);
  });
  it('gives nothing for sealCracked, roomCleared and escaped', () => {
    const notices: Outcome_Notice[] = [{ kind: 'sealCracked', slotId: 's1' }, { kind: 'roomCleared', roomId: 'r1' }, { kind: 'escaped' }];
    expect(selectMotionMoments(BEFORE, stateOf(), notices)).toEqual([]);
  });
  it('returns two laid-to-rest moments in notice order', () => {
    const two: Outcome_Notice[] = [rested, { kind: 'ghostLaidToRest', conceptId: 'c2' }];
    expect(selectMotionMoments(BEFORE, stateOf(), two).map((m) => ('conceptId' in m ? m.conceptId : ''))).toEqual(['c1', 'c2']);
  });
});

describe('momentsForStage', () => {
  const view = { litSlotIds: new Set(['s1']), pendingConceptIds: new Set(['c1']) };
  it('agrees with the State-based choice on lit slots and ghosts', () => {
    expect(momentsForStage([slotLit, spawned, rested], view)).toEqual([
      { kind: 'candle-lit', target: { type: 'slot', slotId: 's1' } },
      { kind: 'ghost-rises', conceptId: 'c1' },
    ]);
  });
  it('gives nothing without notices', () => {
    expect(momentsForStage([], view)).toEqual([]);
  });
});

describe('announcementKeyFor', () => {
  it('names the notice key each moment goes with', () => {
    expect(announcementKeyFor({ kind: 'candle-lit', target: { type: 'spirit' } })).toBe('candleLit');
    expect(announcementKeyFor({ kind: 'ghost-rises', conceptId: 'c' })).toBe('ghostSpawned');
    expect(announcementKeyFor({ kind: 'ghost-laid-to-rest', conceptId: 'c' })).toBe('ghostLaidToRest');
  });
});
