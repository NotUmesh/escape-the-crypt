import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkBuildOutput,
  checkCoreDependencies,
  checkCoreImports,
  checkFileNames,
  checkLineCounts,
  checkSharedTypes,
  runAll,
} from './structure-checks.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A tiny repository that passes every check; tests break one thing at a time. */
function fakeRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'structure-'));
  made.push(root);
  const base: Record<string, string> = {
    'packages/core/package.json': JSON.stringify({ dependencies: { '@noble/hashes': '2.4.0' } }),
    'packages/core/tsconfig.json': JSON.stringify({ compilerOptions: { lib: ['ES2022'] } }),
    'packages/core/src/types.ts': [
      ...['SourceType', 'SourceLocation', 'Chunk', 'PageFlag', 'ResolvedLocation', 'QuoteError', 'Result', 'LimitError', 'IngestError', 'NotesRecord'].map(
        (n) => `export type ${n} = string;`,
      ),
    ].join('\n'),
    'packages/core/src/hash.ts': "import { sha256 } from '@noble/hashes/sha2';\nimport { x } from './types';\nexport const h = sha256;\n",
    ...files,
  };
  for (const [path, text] of Object.entries(base)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe('the real repository', () => {
  it('passes every structure check', () => {
    expect(runAll(REPO)).toEqual([]);
  });
});

describe('core imports', () => {
  it('passes the baseline repo', () => {
    expect(runAll(fakeRepo())).toEqual([]);
  });
  for (const specifier of ['react', 'react-dom/client', 'pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs', 'zod', 'node:fs']) {
    it(`fails on an import of ${specifier}`, () => {
      const root = fakeRepo({ 'packages/core/src/bad.ts': `import x from '${specifier}';\n` });
      expect(checkCoreImports(root).map((v) => v.file)).toEqual(['packages/core/src/bad.ts']);
    });
  }
  it('fails on a dynamic import and a require', () => {
    const root = fakeRepo({
      'packages/core/src/a.ts': "const a = await import('react');\n",
      'packages/core/src/b.ts': "const b = require('pdfjs-dist');\n",
    });
    expect(checkCoreImports(root)).toHaveLength(2);
  });
  it('fails on a DOM global but not on one mentioned in a comment', () => {
    const root = fakeRepo({
      'packages/core/src/dom.ts': 'export const w = window.innerWidth;\n',
      'packages/core/src/ok.ts': '// the document. and window.size are only words here\nexport const n = 1;\n',
    });
    expect(checkCoreImports(root).map((v) => v.file)).toEqual(['packages/core/src/dom.ts']);
  });
  it('fails when core lib includes DOM', () => {
    const root = fakeRepo({ 'packages/core/tsconfig.json': JSON.stringify({ compilerOptions: { lib: ['ES2022', 'DOM'] } }) });
    expect(checkCoreImports(root)).toHaveLength(1);
  });
  it('lets tests and test helpers import test libraries', () => {
    const root = fakeRepo({
      'packages/core/src/a.test.ts': "import { it } from 'vitest';\nimport fc from 'fast-check';\n",
      'packages/core/src/test-support/arb.ts': "import fc from 'fast-check';\n",
    });
    expect(checkCoreImports(root)).toEqual([]);
  });
});

describe('core dependencies', () => {
  it('fails on a second runtime dependency', () => {
    const root = fakeRepo({
      'packages/core/package.json': JSON.stringify({ dependencies: { '@noble/hashes': '2.4.0', zod: '3.0.0' } }),
    });
    expect(checkCoreDependencies(root)).toHaveLength(1);
  });
  it('fails on a missing dependency, a range and a peer dependency', () => {
    expect(checkCoreDependencies(fakeRepo({ 'packages/core/package.json': '{}' }))).toHaveLength(1);
    for (const version of ['^2.4.0', '~2.4.0', '2.x', 'latest']) {
      const root = fakeRepo({ 'packages/core/package.json': JSON.stringify({ dependencies: { '@noble/hashes': version } }) });
      expect(checkCoreDependencies(root), version).toHaveLength(1);
    }
    const peer = fakeRepo({
      'packages/core/package.json': JSON.stringify({ dependencies: { '@noble/hashes': '2.4.0' }, peerDependencies: { react: '19' } }),
    });
    expect(checkCoreDependencies(peer)).toHaveLength(1);
  });
});

describe('file length', () => {
  const lines = (n: number): string => `${'const a = 1;\n'.repeat(n)}`;
  it('allows exactly 300 lines and fails on 301', () => {
    const ok = fakeRepo({ 'apps/web/src/ok.ts': lines(300) });
    expect(checkLineCounts(ok)).toEqual([]);
    const bad = fakeRepo({ 'apps/web/src/long.ts': lines(301), 'apps/web/e2e/long.e2e.ts': lines(301) });
    expect(checkLineCounts(bad).map((v) => v.file).sort()).toEqual(['apps/web/e2e/long.e2e.ts', 'apps/web/src/long.ts']);
  });
  it('ignores the vendored pdf.js worker and build output', () => {
    const root = fakeRepo({
      'apps/web/public/pdf.worker.min.mjs': lines(5000),
      'apps/web/dist/assets/a.js': lines(5000),
      'apps/web/node_modules/x/a.js': lines(5000),
    });
    expect(checkLineCounts(root)).toEqual([]);
  });
});

describe('file names', () => {
  it('accepts kebab-case, with test, e2e, config and d suffixes', () => {
    const files = ['ingest-flow.tsx', 'ingest-flow.test.tsx', 'ingest-layout.e2e.ts', 'vite.config.ts', 'vite-env.d.ts', 'a1-b2.css'];
    const root = fakeRepo(Object.fromEntries(files.map((f) => [`apps/web/src/${f}`, 'export {};\n'])));
    expect(checkFileNames(root)).toEqual([]);
  });
  it('rejects PascalCase, camelCase and snake_case', () => {
    const files = ['IngestFlow.tsx', 'ingestFlow.ts', 'ingest_flow.ts', 'Ingest-flow.ts'];
    const root = fakeRepo(Object.fromEntries(files.map((f) => [`apps/web/src/${f}`, 'export {};\n'])));
    expect(checkFileNames(root)).toHaveLength(4);
  });
});

describe('shared types', () => {
  it('fails when a shared type is redeclared outside types.ts', () => {
    const root = fakeRepo({ 'apps/web/src/dup.ts': 'export interface Chunk { id: string }\n' });
    expect(checkSharedTypes(root).map((v) => v.detail)).toEqual(['redeclares Chunk']);
  });
  it('fails when types.ts lacks a shared type', () => {
    const root = fakeRepo({ 'packages/core/src/types.ts': 'export type Chunk = string;\n' });
    expect(checkSharedTypes(root).length).toBeGreaterThan(5);
  });
  it('allows other exported types in other files', () => {
    const root = fakeRepo({ 'packages/core/src/local.ts': 'export interface Clock { now(): number }\n' });
    expect(checkSharedTypes(root)).toEqual([]);
  });
});

describe('build output', () => {
  function build(mode: string): string {
    const web = join(REPO, 'apps', 'web');
    const outDir = mkdtempSync(join(tmpdir(), `build-${mode}-`));
    made.push(outDir);
    const viteBin = join(dirname(createRequire(join(web, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');
    // A normal build is `vite build` with no --mode, as `pnpm build` runs it.
    const args = [viteBin, 'build', '--outDir', outDir, '--emptyOutDir', ...(mode === 'production' ? [] : ['--mode', mode])];
    execFileSync(process.execPath, args, { cwd: web, stdio: 'pipe' });
    return outDir;
  }

  it('a normal build has no test-parent or e2e entry', () => {
    const dist = build('production');
    expect(checkBuildOutput(dist)).toEqual([]);
  }, 120_000);

  it('the check does fail on an e2e build, which holds the layout test page', () => {
    const dist = build('e2e');
    const found = checkBuildOutput(dist);
    expect(found.some((v) => v.file.startsWith('test-parent'))).toBe(true);
  }, 120_000);

  it('flags a test page, an e2e entry and a leaked hook in a fake build', () => {
    const root = fakeRepo({
      'dist/index.html': '<html></html>',
      'dist/test-parent.html': '<html></html>',
      'dist/assets/main-AbC123.js': 'globalThis.ingestTest = {};',
      'dist/assets/ingest.e2e.js': '',
    });
    expect(checkBuildOutput(join(root, 'dist')).map((v) => v.file).sort()).toEqual([
      'assets/ingest.e2e.js',
      'assets/main-AbC123.js',
      'test-parent.html',
    ]);
  });

  it('passes a clean fake build and a missing dist folder', () => {
    const root = fakeRepo({ 'dist/index.html': '<html></html>', 'dist/assets/index-x9y8.js': 'console.log(1)' });
    expect(checkBuildOutput(join(root, 'dist'))).toEqual([]);
    expect(checkBuildOutput(join(root, 'no-such-dist'))).toEqual([]);
  });
});