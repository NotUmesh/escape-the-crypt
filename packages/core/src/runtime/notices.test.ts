import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NOTICE_ORDER,
  candleLitForSlot,
  candleLitForSpirit,
  escaped,
  ghostLaidToRest,
  ghostSpawned,
  orderNotices,
  roomCleared,
  sealCracked,
} from './notices';
import type { Outcome_Notice } from './notices';

describe('notices', () => {
  it('lists the fixed order', () => {
    expect(NOTICE_ORDER).toEqual([
      'candleLit',
      'ghostLaidToRest',
      'ghostSpawned',
      'sealCracked',
      'roomCleared',
      'escaped',
    ]);
  });

  it('builds plain records naming the slot, room or concept', () => {
    expect(candleLitForSlot('s1')).toEqual({ kind: 'candleLit', target: { type: 'slot', slotId: 's1' } });
    expect(candleLitForSpirit('r1')).toEqual({ kind: 'candleLit', target: { type: 'spirit', roomId: 'r1' } });
    expect(ghostSpawned('c1')).toEqual({ kind: 'ghostSpawned', conceptId: 'c1' });
    expect(sealCracked('s1')).toEqual({ kind: 'sealCracked', slotId: 's1' });
  });

  it('orders a mixed list', () => {
    const out = orderNotices([escaped(), roomCleared('r1'), ghostSpawned('c1'), ghostLaidToRest('c2'), candleLitForSpirit('r1')]);
    expect(out.map((n) => n.kind)).toEqual(['candleLit', 'ghostLaidToRest', 'ghostSpawned', 'roomCleared', 'escaped']);
  });

  it('keeps build order within a kind and drops a repeated roomCleared or escaped', () => {
    const out = orderNotices([roomCleared('r1'), roomCleared('r2'), roomCleared('r1'), escaped(), escaped()]);
    expect(out).toEqual([roomCleared('r1'), roomCleared('r2'), escaped()]);
  });

  it('sorts any list into order with at most one roomCleared per room', () => {
    const noticeArb: fc.Arbitrary<Outcome_Notice> = fc.oneof(
      fc.constantFrom('a', 'b').map(candleLitForSlot),
      fc.constantFrom('a', 'b').map(ghostSpawned),
      fc.constantFrom('a', 'b').map(ghostLaidToRest),
      fc.constantFrom('a', 'b').map(sealCracked),
      fc.constantFrom('r1', 'r2').map(roomCleared),
      fc.constant(escaped()),
    );
    fc.assert(
      fc.property(fc.array(noticeArb, { maxLength: 12 }), (list) => {
        const out = orderNotices(list);
        const ranks = out.map((n) => NOTICE_ORDER.indexOf(n.kind));
        expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
        const rooms = out.flatMap((n) => (n.kind === 'roomCleared' ? [n.roomId] : []));
        expect(new Set(rooms).size).toBe(rooms.length);
        expect(out.filter((n) => n.kind === 'escaped').length).toBeLessThanOrEqual(1);
      }),
    );
  });
});
