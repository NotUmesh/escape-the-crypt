import { describe, expect, it } from 'vitest';
import { conflictLeftOut, conflictPassage, cryptSetAside, cryptSufficiency } from './copy-conflict';

describe('copy-conflict', () => {
  it('produces the design 1e strings', () => {
    expect(conflictLeftOut('Tides')).toBe(
      'We left out \u201CTides\u201D because two passages in your notes seem to say different things.',
    );
    expect(conflictPassage(2)).toBe('Passage 2');
    expect(cryptSufficiency(3, 4, 2, 4)).toBe(
      'Your notes gave us 3 topics we could ask about. A 4-room crypt needs 4, so this crypt has 2 rooms instead.',
    );
    expect(cryptSetAside(3, 4)).toBe('Some questions were set aside, so this crypt has 3 rooms instead of 4.');
  });

  it('uses singular forms for one', () => {
    expect(cryptSufficiency(1, 3, 1, 3)).toContain('1 topic we');
    expect(cryptSufficiency(1, 3, 1, 3)).toContain('has 1 room instead');
    expect(cryptSetAside(1, 3)).toContain('has 1 room instead of 3');
  });

  it('uses plural forms for zero', () => {
    expect(cryptSufficiency(0, 3, 0, 3)).toContain('0 topics');
    expect(cryptSufficiency(0, 3, 0, 3)).toContain('0 rooms');
  });
});
