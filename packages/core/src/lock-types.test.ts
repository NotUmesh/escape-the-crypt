import { describe, it, expect } from 'vitest';
import { LOCK_TYPES } from './index';
import type { LockType } from './index';

describe('LOCK_TYPES', () => {
  it('contains exactly the six canonical lock types', () => {
    expect(LOCK_TYPES).toHaveLength(6);
    expect(LOCK_TYPES).toContain('rune-cipher');
    expect(LOCK_TYPES).toContain('seance-board');
    expect(LOCK_TYPES).toContain('bone-ordering');
    expect(LOCK_TYPES).toContain('bound-threads');
    expect(LOCK_TYPES).toContain('cursed-object');
    expect(LOCK_TYPES).toContain('combination-dial');
  });

  it('every element satisfies the LockType union', () => {
    // Type-level: assignable to LockType[]
    const typed: readonly LockType[] = LOCK_TYPES;
    for (const t of typed) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
  });
});
