import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filePathFromArgs, filePathFromInput, findFilePath, repoRelative } from './hook-input.ts';

const ROOT = resolve('/repo/root');

describe('findFilePath', () => {
  it('reads the usual keys at the top level', () => {
    expect(findFilePath({ file_path: 'a.ts' })).toBe('a.ts');
    expect(findFilePath({ filePath: 'b.ts' })).toBe('b.ts');
    expect(findFilePath({ path: 'c.ts' })).toBe('c.ts');
    expect(findFilePath({ file: 'd.ts' })).toBe('d.ts');
  });

  it('finds a path nested in the payload', () => {
    expect(findFilePath({ session: { event: { file_path: 'deep.ts' } } })).toBe('deep.ts');
  });

  it('gives up past four levels, and on empty or non-string values', () => {
    expect(findFilePath({ a: { b: { c: { d: { e: { file_path: 'x' } } } } } })).toBeUndefined();
    expect(findFilePath({ file_path: '' })).toBeUndefined();
    expect(findFilePath({ file_path: 3 })).toBeUndefined();
    expect(findFilePath('text')).toBeUndefined();
    expect(findFilePath(null)).toBeUndefined();
  });
});

describe('filePathFromInput', () => {
  it('parses JSON from stdin', () => {
    expect(filePathFromInput('{"file_path":"packages/core/src/a.ts"}')).toBe('packages/core/src/a.ts');
  });

  it('reads empty, blank and unreadable input as no path', () => {
    expect(filePathFromInput('')).toBeUndefined();
    expect(filePathFromInput('   \n')).toBeUndefined();
    expect(filePathFromInput('{not json')).toBeUndefined();
    expect(filePathFromInput('[]')).toBeUndefined();
  });
});

describe('filePathFromArgs', () => {
  it('reads --file and ignores a missing or flag-like value', () => {
    expect(filePathFromArgs(['node', 'x.ts', '--file', 'a/b.ts'])).toBe('a/b.ts');
    expect(filePathFromArgs(['node', 'x.ts'])).toBeUndefined();
    expect(filePathFromArgs(['node', 'x.ts', '--file'])).toBeUndefined();
    expect(filePathFromArgs(['node', 'x.ts', '--file', '--dry-run'])).toBeUndefined();
  });
});

describe('repoRelative', () => {
  it('makes an absolute path relative with forward slashes', () => {
    expect(repoRelative(ROOT, resolve(ROOT, 'packages/core/src/a.ts'))).toBe('packages/core/src/a.ts');
  });

  it('keeps an already relative path inside the repository', () => {
    expect(repoRelative(ROOT, 'packages/core/src/a.ts')).toBe('packages/core/src/a.ts');
    expect(repoRelative(ROOT, './.kiro/specs/x/tasks.md')).toBe('.kiro/specs/x/tasks.md');
  });

  it('is undefined for the root itself and for anything outside it', () => {
    expect(repoRelative(ROOT, ROOT)).toBeUndefined();
    expect(repoRelative(ROOT, '../elsewhere/a.ts')).toBeUndefined();
    expect(repoRelative(ROOT, resolve('/other/place/a.ts'))).toBeUndefined();
  });
});
