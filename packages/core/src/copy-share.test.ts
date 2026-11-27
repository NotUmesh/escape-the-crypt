import { BANNED_COPY_PHRASES } from '@escape-the-crypt/core';
import { describe, expect, it } from 'vitest';
import { GENERIC_CRYPT_NAME, SHARE_COPY, ghostPhrase } from './share-card-copy';

// The same lists the persistence copy test uses.
const LEARNING_GAIN_CLAIMS: readonly string[] = [
  'learn faster',
  'learn more',
  'improve your',
  'better grades',
  'higher grades',
  'retention',
  'remember more',
  'boost your',
];
const FORBIDDEN: readonly string[] = [...BANNED_COPY_PHRASES, ...LEARNING_GAIN_CLAIMS, 'human-reviewed'];

/** Every string the copy can produce, calling each function with a few arguments. */
function everyString(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    const fn = value as (...args: never[]) => unknown;
    for (const args of [['A title', 0], [null, 1], ['A title', 5], ['x', 'y']] as const) {
      try {
        const result = (fn as (...a: unknown[]) => unknown)(...args);
        if (typeof result === 'string') out.push(result);
      } catch {
        // A function that does not take these arguments is skipped.
      }
    }
  } else if (typeof value === 'object' && value !== null) for (const v of Object.values(value)) everyString(v, out);
  return out;
}

describe('share card copy', () => {
  const strings = everyString(SHARE_COPY);

  it('produces text to check', () => {
    expect(strings.length).toBeGreaterThan(15);
  });

  it('uses no banned wording and makes no learning-gain claim', () => {
    for (const text of [...strings, GENERIC_CRYPT_NAME, ghostPhrase(0), ghostPhrase(1), ghostPhrase(9)]) {
      const lower = text.toLowerCase();
      expect(
        FORBIDDEN.filter((term) => lower.includes(term.toLowerCase())),
        text,
      ).toEqual([]);
    }
  });

  it('says how many ghosts remain in plain words', () => {
    expect(ghostPhrase(0)).toBe('no ghosts remaining');
    expect(ghostPhrase(1)).toBe('1 ghost remaining');
    expect(ghostPhrase(3)).toBe('3 ghosts remaining');
  });

  it('writes the headline with the title in quotes, or a generic name for notes', () => {
    expect(SHARE_COPY.headline('The human heart', 2)).toBe('Escaped \u201CThe human heart\u201D with 2 ghosts remaining');
    expect(SHARE_COPY.headline(null, 0)).toBe('Escaped a crypt made from my own notes with no ghosts remaining');
  });

  it('uses a file name that carries nothing about the crypt', () => {
    expect(SHARE_COPY.fileName).toBe('escape-the-crypt-card.png');
  });
});
