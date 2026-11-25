/**
 * Architecture and structure checks (task 12.4). Pure functions over a repository
 * root, so tests can run them on small fake repositories. `check-structure.ts`
 * runs them from `pnpm lint`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly detail: string;
}

export const MAX_FILE_LINES = 300;
/** The shared types that must be declared in `packages/core/src/types.ts` and nowhere else. */
export const SHARED_TYPE_NAMES: readonly string[] = [
  'SourceType',
  'SourceLocation',
  'Chunk',
  'PageFlag',
  'ResolvedLocation',
  'QuoteError',
  'Result',
  'LimitError',
  'IngestError',
  'NotesRecord',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-e2e', 'test-results', 'playwright-report', 'public', '.git']);
const SOURCE_FILE = /\.(?:ts|tsx|css|mjs|js)$/;
const KEBAB_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.(?:test|e2e|config|d))*\.(?:ts|tsx|css|mjs|js)$/;
const norm = (path: string): string => path.replace(/\\/g, '/');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Source folders of the repository: each app and package, plus `scripts`. */
function sourceFiles(root: string): string[] {
  const roots: string[] = [join(root, 'scripts')];
  for (const group of ['apps', 'packages']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      for (const sub of ['src', 'e2e']) roots.push(join(base, name, sub));
    }
  }
  return roots.flatMap((r) => walk(r)).filter((f) => SOURCE_FILE.test(f));
}

/** Test files and test helpers (	est-support folders), which may import test libraries. */
const isTest = (file: string): boolean =>
  /\.(?:test|e2e)\.[a-z]+$/.test(file) || norm(file).includes('/test-support/');
const rel = (root: string, file: string): string => norm(relative(root, file));

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function coreSourceFiles(root: string): string[] {
  return walk(join(root, 'packages', 'core', 'src')).filter((f) => /\.tsx?$/.test(f));
}

/** `packages/core` imports no UI, PDF, DOM or database code. */
export function checkCoreImports(root: string): Violation[] {
  const out: Violation[] = [];
  const specifier = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1/gm;
  const domGlobal = /\b(?:document|window|navigator|localStorage|sessionStorage|indexedDB)\./;
  for (const file of coreSourceFiles(root)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const test = isTest(file);
    for (const m of text.matchAll(specifier)) {
      const name = m[2] ?? '';
      const relative = name.startsWith('.');
      const allowed = relative || name.startsWith('@noble/hashes') || name === 'zod' || (test && /^(?:vitest|fast-check|node:)/.test(name));
      if (!allowed) out.push({ rule: 'core-imports', file: rel(root, file), detail: `imports "${name}"` });
    }
    if (!test && domGlobal.test(text)) {
      out.push({ rule: 'core-imports', file: rel(root, file), detail: 'uses a DOM global' });
    }
  }
  const tsconfig = join(root, 'packages', 'core', 'tsconfig.json');
  if (existsSync(tsconfig) && /"DOM/i.test(readFileSync(tsconfig, 'utf8'))) {
    out.push({ rule: 'core-imports', file: rel(root, tsconfig), detail: 'lib includes DOM' });
  }
  return out;
}

/** `@noble/hashes` and `zod`, each pinned exactly, are the only runtime dependencies of `packages/core`. */
export function checkCoreDependencies(root: string): Violation[] {
  const file = join(root, 'packages', 'core', 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string> | undefined>;
  const out: Violation[] = [];
  const deps = pkg['dependencies'] ?? {};
  const names = Object.keys(deps);
  const allowedNames = ['@noble/hashes', 'zod'];
  if (!names.includes('@noble/hashes') || names.some((n) => !allowedNames.includes(n))) {
    out.push({ rule: 'core-dependencies', file: rel(root, file), detail: `dependencies are [${names.join(', ')}]` });
  }
  for (const name of allowedNames) {
    const version = deps[name];
    if (version !== undefined && !/^\d+\.\d+\.\d+$/.test(version)) {
      out.push({ rule: 'core-dependencies', file: rel(root, file), detail: `${name} "${version}" is not an exact version` });
    }
  }
  for (const field of ['peerDependencies', 'optionalDependencies']) {
    if (Object.keys(pkg[field] ?? {}).length > 0) {
      out.push({ rule: 'core-dependencies', file: rel(root, file), detail: `has ${field}` });
    }
  }
  return out;
}

/** No source file is longer than `max` lines. */
export function checkLineCounts(root: string, max: number = MAX_FILE_LINES): Violation[] {
  const out: Violation[] = [];
  for (const file of sourceFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n').length - (readFileSync(file, 'utf8').endsWith('\n') ? 1 : 0);
    if (lines > max) out.push({ rule: 'file-length', file: rel(root, file), detail: `${lines} lines (limit ${max})` });
  }
  return out;
}

/** Source file names are kebab-case. */
export function checkFileNames(root: string): Violation[] {
  return sourceFiles(root)
    .filter((f) => !KEBAB_FILE.test(f.replace(/^.*[\\/]/, '')))
    .map((f) => ({ rule: 'file-name', file: rel(root, f), detail: 'not kebab-case' }));
}

/** The shared types are declared in `types.ts` and are not redeclared anywhere else. */
export function checkSharedTypes(root: string): Violation[] {
  const typesFile = join(root, 'packages', 'core', 'src', 'types.ts');
  const out: Violation[] = [];
  const declaration = /^export\s+(?:interface|type|class|enum)\s+([A-Za-z0-9_]+)/gm;
  const declared = new Set(Array.from(readFileSync(typesFile, 'utf8').matchAll(declaration), (m) => m[1] ?? ''));
  for (const name of SHARED_TYPE_NAMES) {
    if (!declared.has(name)) out.push({ rule: 'shared-types', file: rel(root, typesFile), detail: `${name} is not declared` });
  }
  for (const file of sourceFiles(root).filter((f) => /\.tsx?$/.test(f) && f !== typesFile && !isTest(f))) {
    for (const m of readFileSync(file, 'utf8').matchAll(declaration)) {
      if (SHARED_TYPE_NAMES.includes(m[1] ?? '')) {
        out.push({ rule: 'shared-types', file: rel(root, file), detail: `redeclares ${m[1]}` });
      }
    }
  }
  return out;
}

/** What a normal build must not contain: the e2e-only layout test page and its hooks. */
const TEST_ONLY_PATH = /(?:^|[\\/._-])(?:test-parent|e2e)(?:[\\/._-]|$)/i;
const TEST_ONLY_TEXT = ['test-parent', 'ingestTest'];

/** A normal build output holds no test-parent or e2e entry. */
export function checkBuildOutput(distDir: string): Violation[] {
  const out: Violation[] = [];
  for (const file of walk(distDir)) {
    const path = norm(relative(distDir, file));
    if (TEST_ONLY_PATH.test(path)) out.push({ rule: 'build-output', file: path, detail: 'test-only file in the build' });
    if (/\.(?:html|js|mjs|css)$/.test(path) && statSync(file).size < 5_000_000) {
      const text = readFileSync(file, 'utf8');
      for (const needle of TEST_ONLY_TEXT) {
        if (text.includes(needle)) out.push({ rule: 'build-output', file: path, detail: `mentions "${needle}"` });
      }
    }
  }
  return out;
}

export function runAll(root: string): Violation[] {
  return [
    ...checkCoreImports(root),
    ...checkCoreDependencies(root),
    ...checkLineCounts(root),
    ...checkFileNames(root),
    ...checkSharedTypes(root),
    // A build is checked when one exists. `pnpm build` writes `apps/web/dist`; e2e builds go to `dist-e2e`.
    ...checkBuildOutput(join(root, 'apps', 'web', 'dist')),
  ];
}