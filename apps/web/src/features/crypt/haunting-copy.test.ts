import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BANNED_COPY_PHRASES } from '@escape-the-crypt/core';
import { HAUNTING_NEW_FILES } from './haunting-scope';

const ROOT = join(process.cwd(), '..', '..');
const EXTRA = ['learning gains', 'mastery', 'exam-ready', '100% accurate'];
/** Files whose job is to name the banned words, so they are not scanned for them. */
const NAMES_THE_WORDS = new Set(['haunting-copy.test.ts']);

function read(file: string): string | null {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

describe('copy in the files this spec adds', () => {
  const files = HAUNTING_NEW_FILES.filter((f) => !NAMES_THE_WORDS.has(f.split('/').at(-1) ?? ''));
  for (const file of files) {
    it(`${file.split('/').at(-1)} uses no banned or overclaiming phrase`, () => {
      const text = read(file);
      if (text === null) return;
      const lower = text.toLowerCase();
      const hits = [...BANNED_COPY_PHRASES, ...EXTRA].filter((p) => lower.includes(p.toLowerCase()));
      expect(hits).toEqual([]);
    });
  }
  it('adds no learner-facing text node in the quill mark', () => {
    const text = read('apps/web/src/features/crypt/quill-mark.tsx') ?? '';
    const jsxText = text.replace(/\/\*[\s\S]*?\*\//g, '').match(/>\s*[A-Za-z][^<>{}]*</g) ?? [];
    expect(jsxText).toEqual([]);
  });
});
