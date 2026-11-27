import { describe, expect, it } from 'vitest';
import {
  DIG_STAGE_IDS,
  FRONT_OF_HOUSE_COPY,
  formatElapsed,
  formatShelfDate,
} from './front-of-house-copy';

const FORBIDDEN = /verified|guaranteed|100% accurate|hallucination-free|mastered|exam-ready/i;

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') out.push(String((value as (...a: number[]) => unknown)(2, 3)));
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe('formatElapsed', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9)).toBe('0:09');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(3660)).toBe('61:00');
  });

  it('floors fractions and reads bad input as 0:00', () => {
    expect(formatElapsed(59.9)).toBe('0:59');
    expect(formatElapsed(-4)).toBe('0:00');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatShelfDate', () => {
  it('writes day, short month and year', () => {
    expect(formatShelfDate(new Date(2026, 10, 27, 12).getTime())).toBe('27 Nov 2026');
  });
});

describe('copy', () => {
  it('has a name for every dig stage', () => {
    for (const id of DIG_STAGE_IDS) expect(FRONT_OF_HOUSE_COPY.dig.stageNames[id].length).toBeGreaterThan(0);
  });

  it('uses the singular for one', () => {
    expect(FRONT_OF_HOUSE_COPY.dig.notesStats(1, 1)).toBe('1 piece · 1 word');
    expect(FRONT_OF_HOUSE_COPY.dig.notesStats(6, 412)).toBe('6 pieces · 412 words');
    expect(FRONT_OF_HOUSE_COPY.dig.stillWorking(1)).toBe('Still working. 1 minute so far.');
    expect(FRONT_OF_HOUSE_COPY.dig.stillWorking(2)).toBe('Still working. 2 minutes so far.');
    expect(FRONT_OF_HOUSE_COPY.book.rooms(1)).toBe('1 room');
  });

  it('never uses the words the product does not claim', () => {
    for (const text of strings(FRONT_OF_HOUSE_COPY)) expect(text).not.toMatch(FORBIDDEN);
  });
});
