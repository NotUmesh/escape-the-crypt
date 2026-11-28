import { describe, expect, it } from 'vitest';

// Phase 1 boundary tests (Req 9.5, 9.8, 27.7).
// This file scans itself too: it never writes the forbidden path or module names
// as one literal; they are assembled from parts below.

// packages/core compiles without Node types, so load Node modules dynamically.
const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
interface DirEntry {
  readonly name: string;
  isDirectory(): boolean;
}
const fs = (await import(fsName!)) as unknown as {
  readdirSync(path: string, opts: { withFileTypes: true }): DirEntry[];
  readFileSync(path: string, enc: string): string;
};
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const allFiles = listTs(here);
const isTest = (f: string): boolean => /\.test\.tsx?$/.test(f);
const sourceFiles = allFiles.filter((f) => !isTest(f));
const rel = (f: string): string => f.slice(here.length + 1);

const HOLDOUT_PATH = ['eval', 'holdout'].join('/');
const HOLDOUT_PATH_WIN = ['eval', 'holdout'].join('\\');

const NETWORK_SPECIFIERS = [
  /^(node:)?(http|https|http2|net|tls|dgram|dns)(\/|$)/,
  /^(undici|node-fetch|axios|got|ws|cross-fetch)$/,
];
const AI_SDK_SPECIFIER = /^(openai|ai|@anthropic-ai\/.*|@ai-sdk\/.*|@google\/generative-ai|@aws-sdk\/client-bedrock.*)$/;
// The name-based ban. Phase 2 folders and the index.ts seam are exempt from this one rule only.
const NAME_BAN = /(^|[/.-])(provider|providers|cassette|cassettes|budget-ledger|budget)([/.-]|$)/i;
const FORBIDDEN_SPECIFIER_PARTS = [...NETWORK_SPECIFIERS, AI_SDK_SPECIFIER, NAME_BAN];

// Folders (relative to core/src) whose files may use provider/cassette/budget names (Phase 2).
const EXEMPT_FOLDERS = ['provider', 'cassette', 'budget', 'pipeline'] as const;
// Folders that keep the full original ban verbatim (Phase 1).
const BANNED_FOLDERS = ['authoring', 'checks', 'locks', 'mapper', 'runtime', 'sample-crypt'] as const;
const inFolder = (f: string, folder: string): boolean => rel(f).startsWith(`${folder}/`);
const isExemptFile = (f: string): boolean => EXEMPT_FOLDERS.some((d) => inFolder(f, d));
// index.ts is the export seam (design): it may re-export from the Phase 2 folders, relative paths only.
const isIndexSeamImport = (f: string, spec: string): boolean =>
  rel(f) === 'index.ts' && EXEMPT_FOLDERS.some((d) => spec.startsWith(`./${d}/`) || spec === `./${d}`);
const violatesNameBan = (f: string, spec: string): boolean =>
  NAME_BAN.test(spec) && !isExemptFile(f) && !isIndexSeamImport(f, spec);
const violatesAnyRule = (f: string, spec: string): boolean =>
  NETWORK_SPECIFIERS.some((re) => re.test(spec)) || AI_SDK_SPECIFIER.test(spec) || violatesNameBan(f, spec);
const FORBIDDEN_GLOBALS = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/];

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

describe('Phase 1 dependency boundary (Req 9.8, 27.7)', () => {
  it('scans a non-trivial set of source files', () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it('no source file imports a network, provider, cassette, budget-ledger or AI SDK module', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles) {
      for (const spec of importSpecifiers(fs.readFileSync(f, 'utf8'))) {
        if (violatesAnyRule(f, spec)) offenders.push(`${rel(f)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no source file calls fetch or uses a network global', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles) {
      const text = fs.readFileSync(f, 'utf8');
      for (const re of FORBIDDEN_GLOBALS) if (re.test(text)) offenders.push(`${rel(f)}: ${re.source}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('Phase 2 exemption narrowing (Req 9.8, 27.7)', () => {
  it('the exemption list does not silently grow', () => {
    expect([...EXEMPT_FOLDERS]).toEqual(['provider', 'cassette', 'budget', 'pipeline']);
    expect(FORBIDDEN_SPECIFIER_PARTS).toHaveLength(4);
  });

  it('the scan finds files in at least one exempted folder', () => {
    expect(sourceFiles.filter(isExemptFile).length).toBeGreaterThan(0);
  });

  it('Phase 1 folders keep the full ban and are not exempt', () => {
    for (const d of BANNED_FOLDERS) {
      const sample = `${here}/${d}/x.ts`;
      expect(isExemptFile(sample)).toBe(false);
      expect(violatesNameBan(sample, '../provider/types')).toBe(true);
      expect(violatesNameBan(sample, '../cassette/store')).toBe(true);
      expect(violatesNameBan(sample, '../budget/ledger')).toBe(true);
    }
  });

  it('only index.ts at the top level may import from the exempt folders', () => {
    expect(violatesNameBan(`${here}/index.ts`, './provider/types')).toBe(false);
    expect(violatesNameBan(`${here}/index.ts`, './pipeline/run')).toBe(false);
    expect(violatesNameBan(`${here}/chunker.ts`, './provider/types')).toBe(true);
    expect(violatesNameBan(`${here}/index.ts`, '../other/provider')).toBe(true);
  });

  it('exempt folders still obey the network, AI SDK and holdout rules', () => {
    const sample = `${here}/provider/x.ts`;
    expect(violatesAnyRule(sample, 'node:http')).toBe(true);
    expect(violatesAnyRule(sample, ['open', 'ai'].join(''))).toBe(true);
    expect(violatesAnyRule(sample, '@ai-sdk/core')).toBe(true);
    expect(violatesAnyRule(sample, './types')).toBe(false);
  });

  it('no file in packages/core, exempt folders included, imports an AI SDK specifier', () => {
    const offenders: string[] = [];
    for (const f of allFiles) {
      for (const spec of importSpecifiers(fs.readFileSync(f, 'utf8'))) {
        if (AI_SDK_SPECIFIER.test(spec)) offenders.push(`${rel(f)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('no final-test-set references (Req 9.5)', () => {
  it('no Phase 1 test or source file references the final test set path', () => {
    const offenders = allFiles
      .filter((f) => {
        const text = fs.readFileSync(f, 'utf8');
        return text.includes(HOLDOUT_PATH) || text.includes(HOLDOUT_PATH_WIN);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the scan covers the Phase 5 acceptance test and the Phase 5 lock check tests', () => {
    const scanned = new Set(allFiles.map(rel));
    for (const name of [
      'phase5-acceptance.test.ts',
      'locks/bone-ordering-checks.test.ts',
      'locks/bound-threads-checks.test.ts',
      'locks/cursed-object-checks.test.ts',
      'locks/combination-dial-checks.test.ts',
    ]) {
      expect(scanned.has(name), `${name} is not scanned for final-test-set references`).toBe(true);
    }
  });
});
describe('no environment reads in packages/core', () => {
  // Patterns are assembled from parts so this file does not match itself.
  const ENV_READ = new RegExp([['process', 'env'].join('\\.'), ['import\\.meta', 'env'].join('\\.')].join('|'));
  it('no file under packages/core/src reads process or import.meta environment variables', () => {
    const offenders = allFiles.filter((f) => ENV_READ.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});
