import { describe, expect, it } from 'vitest';
import { LOCK_TYPES } from '../types';
import { judgeRegistry } from './judge-registry';

const EXPECTED = [
  'bone-ordering',
  'bound-threads',
  'combination-dial',
  'cursed-object',
  'rune-cipher',
  'seance-board',
];

describe('lock type IDs', () => {
  it('LOCK_TYPES are exactly the six kebab-case IDs', () => {
    expect([...LOCK_TYPES].sort()).toEqual(EXPECTED);
  });

  it('registry keys equal exactly the six LockType IDs', () => {
    expect(Object.keys(judgeRegistry).sort()).toEqual(EXPECTED);
  });

  it('registry keys use no camelCase or underscore spelling', () => {
    for (const key of Object.keys(judgeRegistry)) {
      expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(key).not.toMatch(/_|[A-Z]/);
    }
  });

  it('every registry entry is a function', () => {
    for (const judge of Object.values(judgeRegistry)) {
      expect(typeof judge).toBe('function');
    }
  });

  it('lock file names (excluding tests, the registry and *-checks helpers) match the LockType IDs and vice versa', async () => {
    // packages/core compiles without Node types, so load Node modules dynamically.
    const fsSpecifier: string = 'node:fs';
    const urlSpecifier: string = 'node:url';
    const fs = (await import(fsSpecifier)) as unknown as {
      readdirSync(path: string): string[];
    };
    const url = (await import(urlSpecifier)) as unknown as {
      fileURLToPath(href: string): string;
    };
    const href = (import.meta as unknown as { url: string }).url;
    const dir = url.fileURLToPath(href).replace(/[\\/][^\\/]*$/, '');
    const names = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => f.slice(0, -'.ts'.length))
      .filter((n) => n !== 'judge-registry' && n !== 'answer-statement' && !n.endsWith('-checks'))
      .sort();
    expect(names).toEqual(EXPECTED);
  });
});
