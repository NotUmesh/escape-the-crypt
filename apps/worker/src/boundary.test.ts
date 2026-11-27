import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Worker-local boundary test (Req 9.8, 27.7).
// The SDK name and the forbidden path are assembled from parts so this file never
// contains them as one literal.

const SDK = ['open', 'ai'].join('');
const HOLDOUT_PATH = ['eval', 'holdout'].join('/');
const HOLDOUT_PATH_WIN = ['eval', 'holdout'].join('\\');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// Same patterns as packages/core/src/boundary.test.ts.
const OPENAI_SPECIFIER = new RegExp(`^${SDK}(/.*)?$`);
const AI_SDK_SPECIFIER = /^(openai|ai|@anthropic-ai\/.*|@ai-sdk\/.*|@google\/generative-ai|@aws-sdk\/client-bedrock.*)$/;

const SKIP_DIRS = new Set(['node_modules', 'dist']);

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importSpecifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.push(m[1] ?? '');
  }
  return found;
}

// Workspace packages: apps/* and packages/* (pnpm-workspace.yaml).
function workspacePackages(): string[] {
  const dirs: string[] = [];
  for (const group of ['apps', 'packages']) {
    const base = join(repoRoot, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(base, entry.name, 'src'))) {
        dirs.push(`${group}/${entry.name}`);
      }
    }
  }
  return dirs;
}

const packages = workspacePackages();
const filesByPackage = new Map<string, string[]>(
  packages.map((p) => [p, listTs(join(repoRoot, p, 'src'))]),
);
const relRepo = (f: string): string => relative(repoRoot, f).replace(/\\/g, '/');

function offendersFor(pkg: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const f of filesByPackage.get(pkg) ?? []) {
    for (const spec of importSpecifiers(readFileSync(f, 'utf8'))) {
      if (pattern.test(spec)) out.push(`${relRepo(f)}: ${spec}`);
    }
  }
  return out;
}

function readPackageJson(pkg: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, pkg, 'package.json'), 'utf8')) as Record<string, unknown>;
}

describe('worker-local dependency boundary (Req 9.8, 27.7)', () => {
  it('scans the expected workspace packages with a non-trivial number of files', () => {
    expect(packages).toEqual(expect.arrayContaining(['apps/web', 'apps/worker', 'packages/core']));
    expect(filesByPackage.get('packages/core')!.length).toBeGreaterThan(20);
    expect(filesByPackage.get('apps/web')!.length).toBeGreaterThan(10);
    expect(filesByPackage.get('apps/worker')!.length).toBeGreaterThan(3);
  });

  it('only files under apps/worker/src import an openai-shaped specifier', () => {
    const outside = packages
      .filter((p) => p !== 'apps/worker')
      .flatMap((p) => offendersFor(p, OPENAI_SPECIFIER));
    expect(outside).toEqual([]);
  });

  it('inside the worker, the import is confined to apps/worker/src/provider/', () => {
    const outsideSeam = offendersFor('apps/worker', OPENAI_SPECIFIER).filter(
      (o) => !o.startsWith('apps/worker/src/provider/'),
    );
    expect(outsideSeam).toEqual([]);
  });

  it('packages/core and apps/web import no openai-shaped specifier', () => {
    expect(offendersFor('packages/core', OPENAI_SPECIFIER)).toEqual([]);
    expect(offendersFor('apps/web', OPENAI_SPECIFIER)).toEqual([]);
  });

  it('apps/web imports no AI SDK at all', () => {
    expect(offendersFor('apps/web', AI_SDK_SPECIFIER)).toEqual([]);
  });

  it('core and web package.json list no openai dependency', () => {
    const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const pkg of ['packages/core', 'apps/web']) {
      const json = readPackageJson(pkg);
      for (const field of fields) {
        const deps = (json[field] ?? {}) as Record<string, string>;
        expect(Object.keys(deps), `${pkg} ${field}`).not.toContain(SDK);
      }
    }
  });

  it('the worker pins the SDK to an exact version', () => {
    const deps = (readPackageJson('apps/worker')['dependencies'] ?? {}) as Record<string, string>;
    const version = deps[SDK];
    expect(version).toBeDefined();
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('no scanned file references the final test set path', () => {
    const offenders: string[] = [];
    for (const files of filesByPackage.values()) {
      for (const f of files) {
        const text = readFileSync(f, 'utf8');
        if (text.includes(HOLDOUT_PATH) || text.includes(HOLDOUT_PATH_WIN)) offenders.push(relRepo(f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
