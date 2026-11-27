import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { displayOrder, displayOrderAvoiding } from './display-order';

describe('displayOrder', () => {
  it('is deterministic for the same items and seed', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 8 }), fc.string(), (items, seed) => {
        expect(displayOrder(items, seed)).toEqual(displayOrder(items, seed));
      }),
    );
  });
  it('returns a permutation of the items', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 50 }), { maxLength: 10 }), fc.string(), (items, seed) => {
        expect([...displayOrder(items, seed)].sort((a, b) => a - b)).toEqual([...items].sort((a, b) => a - b));
      }),
    );
  });
  it('does not change its input', () => {
    const items = ['a', 'b', 'c'];
    displayOrder(items, 's');
    expect(items).toEqual(['a', 'b', 'c']);
  });
});

describe('displayOrderAvoiding', () => {
  it('never returns the avoided order for lists of 2 to 6 distinct items', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), fc.string(), (n, seed) => {
        const items = Array.from({ length: n }, (_, i) => `i${i}`);
        const result = displayOrderAvoiding(items, seed, (c) => c.every((v, i) => v === items[i]));
        expect(result).not.toEqual(items);
        expect([...result].sort()).toEqual([...items].sort());
      }),
    );
  });
  it('returns the only candidate for a single item', () => {
    expect(displayOrderAvoiding(['x'], 's', () => true)).toEqual(['x']);
  });
  it('avoids a position-wise match against a partner list', () => {
    const rights = ['r0', 'r1', 'r2'];
    const result = displayOrderAvoiding(rights, 'q1', (c) => c.some((v, i) => v === rights[i]));
    expect(result.some((v, i) => v === rights[i])).toBe(false);
  });
});
