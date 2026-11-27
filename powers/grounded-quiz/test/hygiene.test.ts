import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { POWER_DIR } from './support';

// The repository's structure rules (300 lines, kebab-case) applied to the Power's own sources,
// which scripts/check-structure.ts does not scan.
const MAX_LINES = 300;

function files(dir: string): string[] {
  return readdirSync(join(POWER_DIR, dir)).map((name) => `${dir}/${name}`);
}

describe('the Power sources follow the repository rules', () => {
  const sources = [...files('src'), ...files('test'), 'scripts/build.mjs'];

  it('keeps every file at or under 300 lines', () => {
    for (const file of sources) {
      const lines = readFileSync(join(POWER_DIR, file), 'utf8').split('\n').length;
      expect(lines, file).toBeLessThanOrEqual(MAX_LINES);
    }
  });

  it('names files in kebab-case', () => {
    for (const file of sources) expect(file.split('/').pop(), file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.test)?\.(?:ts|mjs)$/);
  });

  it('reaches into packages/core from one file only, and edits nothing there', () => {
    const importers = files('src').filter((f) => /packages\/core/.test(readFileSync(join(POWER_DIR, f), 'utf8')));
    expect(importers).toEqual(['src/core-imports.ts']);
  });

  it('uses no dynamic code execution', () => {
    for (const file of files('src')) expect(readFileSync(join(POWER_DIR, file), 'utf8'), file).not.toMatch(/\beval\(|new Function|child_process|node:net|node:http|node:fs/);
  });
});
