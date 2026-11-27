import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, runSettingsFor, showsRuneLetterCount } from './difficulty';
import { RUN_LENGTHS, cryptTargetFor, lengthAvailability } from './run-length';

describe('cryptTargetFor', () => {
  it('maps short, standard and long to 2, 3 and 4 rooms of two locks, with three concepts per room', () => {
    expect(cryptTargetFor('short')).toEqual({ rooms: 2, locksPerRoom: 2, maxConcepts: 6 });
    expect(cryptTargetFor('standard')).toEqual({ rooms: 3, locksPerRoom: 2, maxConcepts: 9 });
    expect(cryptTargetFor('long')).toEqual({ rooms: 4, locksPerRoom: 2, maxConcepts: 12 });
  });

  it('is the one list of lengths', () => {
    expect([...RUN_LENGTHS]).toEqual(['short', 'standard', 'long']);
  });
});

describe('lengthAvailability', () => {
  it('always offers short, and offers longer lengths from 6 quotable chunks', () => {
    expect(lengthAvailability(0).enabled).toEqual({ short: true, standard: false, long: false });
    expect(lengthAvailability(5)).toMatchObject({ largest: 'short' });
    expect(lengthAvailability(6).enabled).toEqual({ short: true, standard: true, long: true });
    expect(lengthAvailability(6).largest).toBe('long');
  });

  it('never switches a length off for a larger note', () => {
    fc.assert(
      fc.property(fc.nat({ max: 40 }), (chunks) => {
        const now = lengthAvailability(chunks).enabled;
        const more = lengthAvailability(chunks + 1).enabled;
        for (const length of RUN_LENGTHS) if (now[length]) expect(more[length]).toBe(true);
        expect(now.short).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('difficulty', () => {
  it('gives 3, 2 and 0 hints and shows the rune letter count except for the lich', () => {
    expect(DIFFICULTIES.map((d) => runSettingsFor('short', d).hintAllowance)).toEqual([3, 2, 0]);
    expect(DIFFICULTIES.map(showsRuneLetterCount)).toEqual([true, true, false]);
  });

  it('keeps the chosen length and difficulty in the settings', () => {
    expect(runSettingsFor('long', 'lich')).toEqual({ length: 'long', difficulty: 'lich', hintAllowance: 0 });
  });

  it('never depends on the length: difficulty alone sets the hints', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RUN_LENGTHS), fc.constantFrom(...DIFFICULTIES), (length, difficulty) => {
        expect(runSettingsFor(length, difficulty).hintAllowance).toBe(runSettingsFor('short', difficulty).hintAllowance);
      }),
      { numRuns: 30 },
    );
  });
});
