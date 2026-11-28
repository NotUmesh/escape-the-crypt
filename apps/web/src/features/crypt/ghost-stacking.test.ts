import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(join(process.cwd(), 'src', 'features', 'crypt', name), 'utf8');
const ghosts = read('ghost-layer.css');
const stage = read('art-stage.css');

function zIndex(css: string, selector: string): number {
  const m = new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css);
  if (m?.[1] === undefined) throw new Error(`no z-index for ${selector}`);
  return Number(m[1]);
}

describe('ghost stacking', () => {
  it('puts the ghosts under the controls', () => {
    expect(zIndex(ghosts, '.ghost-layer')).toBeLessThan(zIndex(stage, '.art-stage__controls'));
  });
  it('gives ghost return numbers a solid backing and a resting opacity of 1', () => {
    expect(ghosts).toMatch(/\.ghost-art::after\s*\{[^}]*background:\s*var\(--stone-950\)/);
    expect(ghosts).toMatch(/\.ghost-art\s*\{[^}]*opacity:\s*1\s*;/);
  });
});
