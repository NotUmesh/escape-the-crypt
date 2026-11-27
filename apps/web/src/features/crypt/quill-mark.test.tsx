import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { auditCss } from './motion-css-audit';
import { QuillMark } from './quill-mark';

const DIR = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(DIR, 'quill-mark.css'), 'utf8');

function media(initial: boolean): { setReduced(next: boolean): void } {
  let reduced = initial;
  let listener: ((e: { matches: boolean }) => void) | null = null;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return reduced && query.includes('prefers-reduced-motion');
    },
    media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
  }));
  return {
    setReduced(next) {
      reduced = next;
      act(() => listener?.({ matches: next }));
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('QuillMark', () => {
  const mount = useMount();
  const svg = (): SVGElement => mount.container.querySelector('svg') as unknown as SVGElement;
  it('is hidden from assistive technology and holds nothing focusable or readable', () => {
    media(false);
    mount.render(createElement(QuillMark));
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(mount.container.querySelector('[tabindex], a, button, input')).toBeNull();
    expect(mount.container.textContent).toBe('');
  });
  it('has the finished stroke in the DOM at first render', () => {
    media(false);
    mount.render(createElement(QuillMark));
    const stroke = mount.container.querySelector('.quill-mark__stroke');
    expect(stroke?.getAttribute('pathLength')).toBe('1');
    expect(CSS).toMatch(/\.quill-mark__stroke\s*\{[^}]*stroke-dashoffset:\s*0/);
  });
  it('animates only under no-preference, in at most 1000 ms, once', () => {
    expect(auditCss(CSS)).toEqual([]);
    expect(CSS).toMatch(/prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*quill-write 900ms/);
    expect(CSS).not.toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(CSS).toMatch(/pointer-events:\s*none/);
  });
  it('follows a change of the reduced-motion preference while mounted', () => {
    const control = media(false);
    mount.render(createElement(QuillMark));
    expect(svg().getAttribute('data-reduced-motion')).toBe('false');
    control.setReduced(true);
    expect(svg().getAttribute('data-reduced-motion')).toBe('true');
  });
  it('is imported by no existing module yet (it stays unmounted until Open_Decision 2)', () => {
    const importers = readdirSync(DIR)
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx') && f !== 'quill-mark.tsx')
      .filter((f) => /from '\.\/quill-mark'/.test(readFileSync(join(DIR, f), 'utf8')));
    expect(importers).toEqual([]);
  });
});
