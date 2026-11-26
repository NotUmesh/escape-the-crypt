import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES, LOCK_OBJECT_NAMES } from '@escape-the-crypt/core';
import type { LockType, SlotStatus } from '@escape-the-crypt/core';
import { doorButtonName, ghostName, lockName, returnSlotName, sealName } from './accessible-names';

const STATUSES: readonly SlotStatus[] = ['open', 'solved', 'settled', 'challenged'];

const LOCK_TABLE: ReadonlyArray<readonly [SlotStatus, string]> = [
  ['open', 'Rune tablet: rune cipher, unsolved'],
  ['solved', 'Rune tablet: rune cipher, solved'],
  ['settled', 'Rune tablet: rune cipher, settled, excluded from score'],
  ['challenged', 'Rune tablet: rune cipher, challenged, excluded from score'],
];

const SEAL_TABLE: ReadonlyArray<readonly [SlotStatus, string]> = [
  ['open', 'Seal 2, not yet answered'],
  ['solved', 'Seal 2, solved'],
  ['settled', 'Seal 2, excluded from score'],
  ['challenged', 'Seal 2, challenged, excluded from score'],
];

const RETURN_TABLE: ReadonlyArray<readonly [boolean, SlotStatus, string]> = [
  [false, 'open', 'Returning question, unsolved'],
  [true, 'open', 'Returning question: Review, unsolved'],
  [false, 'solved', 'Returning question, solved'],
  [true, 'settled', 'Returning question: Review, settled, excluded from score'],
  [false, 'challenged', 'Returning question, challenged, excluded from score'],
];

describe('accessible names', () => {
  it.each(LOCK_TABLE)('lock name for %s', (status, expected) => {
    expect(lockName('rune-cipher', status)).toBe(expected);
  });

  it.each(SEAL_TABLE)('seal name for %s', (status, expected) => {
    expect(sealName(2, status)).toBe(expected);
  });

  it.each(RETURN_TABLE)('return slot name (review=%s, %s)', (isReview, status, expected) => {
    expect(returnSlotName(isReview, status)).toBe(expected);
  });

  it('ghost name states its return number and that it returns later', () => {
    expect(ghostName(2)).toBe('Ghost 2: returns later');
  });

  it('final door button name offers to open the final door', () => {
    expect(doorButtonName()).toBe('Open the final door');
  });

  it('names every lock type and status, each different per status, with no banned phrase', () => {
    const types = Object.keys(LOCK_OBJECT_NAMES) as LockType[];
    expect(types).toHaveLength(6);
    for (const type of types) {
      const names = STATUSES.map((s) => lockName(type, s));
      expect(new Set(names).size).toBe(STATUSES.length);
      for (const name of [...names, ...STATUSES.map((s) => sealName(1, s))]) {
        for (const phrase of BANNED_COPY_PHRASES) {
          expect(name.toLowerCase()).not.toContain(phrase.toLowerCase());
        }
      }
    }
  });
});
