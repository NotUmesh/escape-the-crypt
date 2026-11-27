import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKENS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');

function token(name: string): readonly [number, number, number] {
  const hex = new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`).exec(TOKENS)?.[1];
  if (hex === undefined) throw new Error(`token ${name} not found`);
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(foreground: string, background: string): number {
  const a = luminance(token(foreground));
  const b = luminance(token(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every text-on-panel pairing the pre-crypt screens use, read from tokens.css. Body text needs 4.5. */
const TEXT_PAIRS: readonly (readonly [string, string, string])[] = [
  ['--bone-50', '--stone-800', 'panel text'],
  ['--stone-300', '--stone-800', 'panel notes and labels'],
  ['--bone-50', '--stone-950', 'spine and button text'],
  ['--stone-300', '--stone-950', 'spine meta and status'],
  ['--spectre-300', '--stone-950', 'selected word and focus ring on dark'],
  ['--spectre-300', '--stone-800', 'focus ring on a panel'],
  ['--stone-950', '--spectre-300', 'primary button text'],
  ['--ink-900', '--parchment-100', 'text on the page'],
];

describe('contrast of the pre-crypt screens', () => {
  for (const [foreground, background, use] of TEXT_PAIRS) {
    it(`${use}: ${foreground} on ${background} is at least 4.5:1`, () => {
      expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('gold icons on the dark spine are at least 3:1 (non-text)', () => {
    expect(ratio('--candle-400', '--stone-950')).toBeGreaterThanOrEqual(3);
  });

  it('keeps ember text off stone panels, as the design system requires', () => {
    expect(ratio('--ember-600', '--stone-800')).toBeLessThan(4.5);
  });
});
