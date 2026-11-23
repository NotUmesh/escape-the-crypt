import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assemblePageText, type TextItemData } from './pdf-text-assembly';

const item = (str: string, y: number, hasEOL = false, height = 10): TextItemData => ({
  str,
  y,
  height,
  hasEOL,
});

describe('assemblePageText', () => {
  it('returns an empty string for an empty page', () => {
    expect(assemblePageText([])).toBe('');
  });

  it('breaks the line when an item has hasEOL', () => {
    expect(assemblePageText([item('one', 100, true), item('two', 100)])).toBe('one\ntwo');
  });

  it('breaks the line when y changes', () => {
    expect(assemblePageText([item('one', 100), item('two', 88)])).toBe('one\ntwo');
  });

  it('joins items on the same baseline without a break', () => {
    expect(assemblePageText([item('one ', 100), item('two', 100)])).toBe('one two');
  });

  it('gives a blank line when the gap is above 1.5 times the median height', () => {
    expect(assemblePageText([item('one', 100), item('two', 84)])).toBe('one\n\ntwo');
  });

  it('gives a single break when the gap is exactly 1.5 times the median height', () => {
    expect(assemblePageText([item('one', 100), item('two', 85)])).toBe('one\ntwo');
  });
});

describe('assemblePageText properties', () => {
  /** **Validates: Requirements 2.1, 6.1** */
  it('keeps non-whitespace characters in order and never emits three line breaks in a row', () => {
    const itemArb = fc.record({
      str: fc.string({ unit: fc.constantFrom('a', 'b', 'Z', '7', ' ', '.', 'é'), maxLength: 8 }),
      y: fc.integer({ min: 0, max: 800 }),
      height: fc.integer({ min: 1, max: 30 }),
      hasEOL: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 30 }), (items) => {
        const out = assemblePageText(items);
        const strip = (s: string) => s.replace(/\s+/g, '');
        expect(strip(out)).toBe(strip(items.map((i) => i.str).join('')));
        expect(out).not.toMatch(/\n\n\n/);
      }),
    );
  });
});
