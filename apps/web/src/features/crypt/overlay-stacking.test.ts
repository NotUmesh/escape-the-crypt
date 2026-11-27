import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(join(process.cwd(), 'src', 'features', 'crypt', name), 'utf8');
const atmosphere = read('atmosphere-layer.css');
const ghosts = read('ghost-layer.css');
const stage = read('art-stage.css');

function zIndex(css: string, selector: string): number {
  const m = new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css);
  if (m?.[1] === undefined) throw new Error(`no z-index for ${selector}`);
  return Number(m[1]);
}

describe('overlay stacking', () => {
  it('puts the overlay under the ghosts and the ghosts under the controls', () => {
    expect(zIndex(atmosphere, '.atmosphere')).toBeLessThan(zIndex(ghosts, '.ghost-layer'));
    expect(zIndex(ghosts, '.ghost-layer')).toBeLessThan(zIndex(stage, '.art-stage__controls'));
  });
  it('takes no pointer events, on the container or any part', () => {
    expect(atmosphere).toMatch(/\.atmosphere\s*\{[^}]*pointer-events:\s*none/);
    expect(atmosphere).toMatch(/\.atmosphere > span\s*\{[^}]*pointer-events:\s*none/);
  });
  it('draws no image file', () => {
    expect(atmosphere).not.toMatch(/url\(/);
  });
  it('moves only opacity and background position', () => {
    const keyframes = [...atmosphere.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '');
    for (const body of keyframes) {
      expect(body).not.toMatch(/transform|filter|width|height/);
    }
  });
  it('runs the mist drift only when motion is allowed', () => {
    expect(atmosphere).toMatch(/prefers-reduced-motion: no-preference\)\s*\{[^}]*\.atmosphere__mist\s*\{[^}]*animation:\s*atmosphere-drift/);
    expect(atmosphere).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.atmosphere__mist\s*\{\s*animation:\s*none/);
  });
  it('gives ghost return numbers a solid backing and a resting opacity of 1', () => {
    expect(ghosts).toMatch(/\.ghost-art::after\s*\{[^}]*background:\s*var\(--stone-950\)/);
    expect(ghosts).toMatch(/\.ghost-art\s*\{[^}]*opacity:\s*1\s*;/);
  });
});
