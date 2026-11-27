import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES, renderError } from './copy';
import { JUDGE_ACCESS_COPY, JUDGE_ACCESS_DENIED_COPY } from './copy-judge';
import { GENERATION_COPY } from './copy-room-play';

const LEARNING_GAIN_CLAIMS = ['learn faster', 'better grades', 'retention', 'boost your'];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe('judge access copy', () => {
  it('uses no banned wording and makes no learning-gain claim', () => {
    for (const text of strings(JUDGE_ACCESS_COPY)) {
      const lower = text.toLowerCase();
      expect([...BANNED_COPY_PHRASES, ...LEARNING_GAIN_CLAIMS].filter((term) => lower.includes(term.toLowerCase())), text).toEqual([]);
    }
  });

  it('says what happened and what to do next when the code is refused', () => {
    expect(JUDGE_ACCESS_DENIED_COPY.what).not.toBe('');
    expect(JUDGE_ACCESS_DENIED_COPY.next).not.toBe('');
    expect(GENERATION_COPY.failures['judge-access-denied']).toBe(JUDGE_ACCESS_DENIED_COPY);
  });

  it('never repeats a code: the copy has no placeholder for one', () => {
    expect(renderError(JUDGE_ACCESS_DENIED_COPY)).not.toMatch(/\{|\$\{|%s/);
  });

  it('tells the learner the code is kept in the tab only', () => {
    expect(JUDGE_ACCESS_COPY.hint).toContain('not saved');
  });
});
