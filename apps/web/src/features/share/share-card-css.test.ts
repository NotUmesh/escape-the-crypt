import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFile } from '../ingest/style-guard-rules';
import { SHARE_URL } from '@escape-the-crypt/core';

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const TOKENS = read('src/styles/tokens.css');
const CSS = read('src/features/share/share-card.css');

function channelsOf(name: string): readonly [number, number, number] {
  const hex = new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`).exec(TOKENS)?.[1] ?? '';
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(c: readonly [number, number, number]): number {
  const f = (v: number): number => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function ratio(a: string, b: string): number {
  const [x, y] = [luminance(channelsOf(a)), luminance(channelsOf(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  return start < 0 ? '' : CSS.slice(start, CSS.indexOf('}', start));
}

describe('share card styles', () => {
  it('puts the section on its own dark surface with light text, not on parchment', () => {
    const section = rule('.share-section');
    expect(section).toContain('background: var(--stone-800)');
    expect(section).toContain('color: var(--bone-50)');
    expect(ratio('--bone-50', '--stone-800')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the quieter lines readable on that surface', () => {
    expect(rule('.share-section__privacy,\n.share-section__status').length).toBeGreaterThan(0);
    expect(ratio('--stone-300', '--stone-800')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the card itself as ink on parchment', () => {
    const card = rule('.share-card');
    expect(card).toContain('background: var(--parchment-100)');
    expect(card).toContain('color: var(--ink-900)');
    expect(ratio('--ink-900', '--parchment-100')).toBeGreaterThanOrEqual(4.5);
  });

  it('writes no colour literal', () => {
    expect(scanFile('apps/web/src/features/share/share-card.css', CSS)).toEqual([]);
  });
});

describe('the public address in the shared text', () => {
  it('lives in core copy, so app source may not hold it', () => {
    const line = `export const SHARE_URL = '${SHARE_URL}';`;
    for (const path of ['apps/web/src/features/share/share-card.tsx', 'apps/web/src/features/share/share-card-lines.ts', 'apps/web/src/features/crypt/other.ts']) {
      expect(scanFile(path, line).map((v) => v.rule)).toContain('cross-origin-url');
    }
  });
});
