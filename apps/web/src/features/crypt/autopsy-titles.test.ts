import { describe, expect, it } from 'vitest';
import type { AutopsyEntry, CryptContent } from '@escape-the-crypt/core';

import { withConceptTitles } from './autopsy-titles';

function entry(conceptId: string): AutopsyEntry {
  return { conceptId, outcome: 'first-try-correct', label: 'First try' };
}

function contentWith(concepts: Record<string, { title: string }>): CryptContent {
  return { questions: {}, concepts };
}

describe('withConceptTitles', () => {
  it('gives every entry its concept title and keeps order', () => {
    const content = contentWith({ a: { title: 'Alpha' }, b: { title: 'Beta' }, c: { title: 'Gamma' } });
    const result = withConceptTitles([entry('c'), entry('a'), entry('b')], content);
    expect(result.map((e) => e.conceptId)).toEqual(['c', 'a', 'b']);
    expect(result.map((e) => e.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(result[0]?.outcome).toBe('first-try-correct');
  });

  it('falls back to the concept ID when the title is missing', () => {
    const result = withConceptTitles([entry('ghost-1'), entry('toString')], contentWith({}));
    expect(result.map((e) => e.title)).toEqual(['ghost-1', 'toString']);
  });

  it('returns a title with markup characters as the same plain string', () => {
    const title = '<b>Heart</b> & "valves" <script>x</script>';
    const [result] = withConceptTitles([entry('a')], contentWith({ a: { title } }));
    expect(result?.title).toBe(title);
  });
});
