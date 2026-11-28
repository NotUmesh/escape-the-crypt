import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES, renderError } from './copy';
import { IMPORT_COPY, IMPORT_ERROR_KINDS } from './copy-import';

const LEARNING_GAIN_CLAIMS = ['learn faster', 'learn more', 'improve your', 'better grades', 'retention', 'remember more', 'boost your'];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe('import copy', () => {
  it('has a message for every kind, each saying what happened and what to do', () => {
    expect(Object.keys(IMPORT_COPY.errors).sort()).toEqual([...IMPORT_ERROR_KINDS].sort());
    for (const kind of IMPORT_ERROR_KINDS) {
      const copy = IMPORT_COPY.errors[kind];
      expect(copy.what.length, kind).toBeGreaterThan(10);
      expect(copy.next.length, kind).toBeGreaterThan(10);
    }
  });

  it('says in every failure that nothing was changed', () => {
    for (const kind of IMPORT_ERROR_KINDS) {
      expect(renderError(IMPORT_COPY.errors[kind]), kind).toMatch(/nothing was changed|left as (?:they are|it is)/i);
    }
  });

  it('uses no banned wording and makes no learning-gain claim', () => {
    for (const text of strings(IMPORT_COPY)) {
      const lower = text.toLowerCase();
      expect([...BANNED_COPY_PHRASES, ...LEARNING_GAIN_CLAIMS].filter((term) => lower.includes(term.toLowerCase())), text).toEqual([]);
    }
  });

  it('never has a placeholder that could carry file text into a message', () => {
    for (const text of strings(IMPORT_COPY)) expect(text).not.toMatch(/\$\{|\{\w+\}|%s/);
  });
});
