import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8');

const EXPECTED = {
  '--stone-950': '#0e0d0c',
  '--stone-800': '#2a2623',
  '--stone-300': '#b8afa6',
  '--bone-50': '#f4efe6',
  '--spectre-300': '#9fd4d0',
  '--candle-400': '#f2a33a',
  '--ember-600': '#b4471f',
  '--parchment-100': '#e9dfc8',
  '--ink-900': '#2b2118',
} as const;

type TokenName = keyof typeof EXPECTED;

function parseVars(source: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(m[1] ?? '', (m[2] ?? '').trim());
  }
  return vars;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const vars = parseVars(css);
const colour = (name: TokenName): string => vars.get(name) ?? '';

interface Pair {
  readonly text: TokenName;
  readonly surface: TokenName;
  readonly kind: 'body' | 'large';
}

/** Pairs from the design's colour-role table. "any" surface = both dark surfaces. */
const PAIRS: readonly Pair[] = [
  { text: '--bone-50', surface: '--stone-800', kind: 'body' },
  { text: '--stone-300', surface: '--stone-800', kind: 'body' },
  { text: '--ink-900', surface: '--parchment-100', kind: 'body' },
  { text: '--spectre-300', surface: '--stone-950', kind: 'body' },
  { text: '--spectre-300', surface: '--stone-800', kind: 'body' },
  { text: '--candle-400', surface: '--stone-950', kind: 'body' },
  { text: '--candle-400', surface: '--stone-800', kind: 'body' },
  // Ember is emphasis only: large text on the darkest surface and on parchment.
  // On --stone-800 it is below 3:1, so it must not carry text there.
  { text: '--ember-600', surface: '--stone-950', kind: 'large' },
  { text: '--ember-600', surface: '--parchment-100', kind: 'large' },
];

describe('tokens.css palette', () => {
  for (const [name, value] of Object.entries(EXPECTED)) {
    it(`defines ${name} as ${value}`, () => {
      expect(vars.get(name)?.toLowerCase()).toBe(value);
    });
  }

  it('keeps font and focus variables free of colour literals', () => {
    for (const name of ['--font-title', '--font-body', '--focus-ring', '--focus-ring-on-light', '--focus-offset']) {
      const value = vars.get(name);
      expect(value, name).toBeDefined();
      expect(value).not.toMatch(/#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(/i);
    }
    expect(vars.get('--focus-ring')).toContain('var(--spectre-300)');
    expect(vars.get('--focus-ring-on-light')).toContain('var(--ink-900)');
  });
});

describe('WCAG contrast for the colour-role table', () => {
  it('computes known reference ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  for (const { text, surface, kind } of PAIRS) {
    const min = kind === 'body' ? 4.5 : 3;
    it(`${text} on ${surface} is at least ${min}:1 (${kind})`, () => {
      expect(contrast(colour(text), colour(surface))).toBeGreaterThanOrEqual(min);
    });
  }

  it('shows why ember text is not allowed on --stone-800', () => {
    expect(contrast(colour('--ember-600'), colour('--stone-800'))).toBeLessThan(3);
  });

  it('uses --ink-900 for text on --parchment-100', () => {
    const onParchment = PAIRS.filter((p) => p.surface === '--parchment-100' && p.kind === 'body');
    expect(onParchment.length).toBeGreaterThan(0);
    for (const p of onParchment) expect(p.text).toBe('--ink-900');
    // The light and accent text colours do not reach body contrast on parchment.
    const lightText: TokenName[] = ['--bone-50', '--stone-300', '--spectre-300', '--candle-400', '--ember-600'];
    for (const name of lightText) {
      expect(contrast(colour(name), colour('--parchment-100')), name).toBeLessThan(4.5);
    }
  });
});

/** The colour token a focus-ring variable points at, e.g. `2px solid var(--ink-900)`. */
function ringColour(variable: string): TokenName {
  const match = /var\((--[\w-]+)\)/.exec(vars.get(variable) ?? '');
  return (match?.[1] ?? '') as TokenName;
}

describe('WCAG 1.4.11 contrast for focus rings (3:1 against the surface)', () => {
  const RINGS: ReadonlyArray<{ variable: string; surface: TokenName }> = [
    { variable: '--focus-ring', surface: '--stone-950' },
    { variable: '--focus-ring', surface: '--stone-800' },
    { variable: '--focus-ring-on-light', surface: '--parchment-100' },
  ];
  for (const { variable, surface } of RINGS) {
    it(`${variable} on ${surface} is at least 3:1`, () => {
      const ring = ringColour(variable);
      expect(EXPECTED[ring], `${variable} must point at a palette colour`).toBeDefined();
      expect(contrast(colour(ring), colour(surface))).toBeGreaterThanOrEqual(3);
    });
  }
  it('shows why parchment needs its own ring: the teal ring is under 3:1 there', () => {
    expect(contrast(colour('--spectre-300'), colour('--parchment-100'))).toBeLessThan(3);
  });
});