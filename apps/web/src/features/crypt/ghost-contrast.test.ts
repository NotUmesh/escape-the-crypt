import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Rgb = readonly [number, number, number];
const TOKENS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');

function token(name: string): Rgb {
  const hex = new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`).exec(TOKENS)?.[1];
  if (hex === undefined) throw new Error(`token ${name} not found`);
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratioOf(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
describe('room status contrast', () => {
  it('ghost return numbers (bone on stone-950) keep at least 4.5:1', () => {
    expect(ratioOf(token('--bone-50'), token('--stone-950'))).toBeGreaterThanOrEqual(4.5);
  });
  it('the challenged note (bone on stone-800) keeps at least 4.5:1', () => {
    expect(ratioOf(token('--bone-50'), token('--stone-800'))).toBeGreaterThanOrEqual(4.5);
  });
});
