import { describe, expect, it } from 'vitest';
import type { LockType, SlotStatus } from '@escape-the-crypt/core';
import { lightImageFile, lockImageFile, shouldDrawFlame } from './lock-layer';

const STATUSES: readonly SlotStatus[] = ['open', 'solved', 'settled', 'challenged'];
const LOCKS: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];

describe('lockImageFile', () => {
  const cases = STATUSES.flatMap((status) =>
    [false, true].map((hovered) => ({
      status,
      hovered,
      expected: `${status === 'open' ? 'lock-rune-cipher' : 'lock-rune-cipher-solved'}${hovered ? '-hover' : ''}.webp`,
    })),
  );
  it.each(cases)('$status, hovered $hovered -> $expected', ({ status, hovered, expected }) => {
    expect(lockImageFile('rune-cipher', status, hovered)).toBe(expected);
  });

  it('names a file for every lock type', () => {
    for (const lock of LOCKS) {
      expect(lockImageFile(lock, 'open', false)).toBe(`lock-${lock}.webp`);
      expect(lockImageFile(lock, 'challenged', true)).toBe(`lock-${lock}-solved-hover.webp`);
    }
  });
});

describe('shouldDrawFlame', () => {
  const table: readonly [SlotStatus, boolean, boolean][] = [
    ['open', false, false],
    ['open', true, true],
    ['solved', false, false],
    ['solved', true, true],
    ['settled', false, false],
    ['settled', true, false],
    ['challenged', false, false],
    ['challenged', true, false],
  ];
  it.each(table)('%s with candleLit %s -> %s', (status, candleLit, expected) => {
    expect(shouldDrawFlame(status, candleLit)).toBe(expected);
  });

  it('covers every status with both candleLit values', () => {
    for (const status of STATUSES) {
      for (const lit of [false, true]) {
        expect(table.some(([s, l]) => s === status && l === lit)).toBe(true);
      }
    }
  });
});

describe('lightImageFile', () => {
  it('names the light pass of a lock', () => {
    expect(lightImageFile('seance-board')).toBe('light-seance-board.webp');
  });
});
