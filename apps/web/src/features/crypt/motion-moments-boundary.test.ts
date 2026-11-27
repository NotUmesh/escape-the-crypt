import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { HAUNTING_NEW_FILES } from './haunting-scope';
import { QuillMark } from './quill-mark';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..', '..', '..', '..', '..');

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const FORBIDDEN: readonly [string, RegExp][] = [
  ['the reducer', /\bapply\b|\binitial\b/],
  ['dispatch', /\bdispatch\b/],
  ['an Event creator', /kind:\s*'(RunStarted|AnswerSubmitted|Skipped|Challenged|EvidenceContinued|LockOpened)'/],
  ['browser storage', /localStorage|sessionStorage|indexedDB/],
  ['the network', /\bfetch\s*\(|XMLHttpRequest/],
];
/** Files that read the runtime on purpose, to build test runs. */
const RUN_BUILDERS = new Set(['motion-moments-properties.test.ts', 'motion-moments-boundary.test.ts', 'scope-fence.test.ts']);

describe('new motion files stay read-only', () => {
  const sources = HAUNTING_NEW_FILES.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  it('has non-test source files to check', () => {
    expect(sources.length).toBeGreaterThan(2);
  });
  for (const file of sources) {
    it(`${file.split('/').at(-1)} imports and names none of the write paths`, () => {
      let text: string;
      try {
        text = code(readFileSync(join(ROOT, file), 'utf8'));
      } catch {
        return; // Not written yet.
      }
      for (const [what, pattern] of FORBIDDEN) {
        expect(pattern.test(text), `${file} uses ${what}`).toBe(false);
      }
    });
  }
  it('lists which files may read the runtime', () => {
    expect([...RUN_BUILDERS].every((f) => HAUNTING_NEW_FILES.some((p) => p.endsWith(f)))).toBe(true);
  });
});

describe('QuillMark leaves everything else alone', () => {
  const mount = useMount();
  it('reads and writes no storage, before or after the animation end event', () => {
    const before = JSON.stringify({ ...localStorage });
    mount.render(createElement(QuillMark));
    act(() => {
      mount.container.querySelector('.quill-mark__stroke')?.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(JSON.stringify({ ...localStorage })).toBe(before);
  });
});
