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

const FORBIDDEN_SPECIFIER_PARTS = [
  /^(node:)?(http|https|http2|net|tls|dgram|dns)(\/|$)/,
  /^(undici|node-fetch|axios|got|ws|cross-fetch)$/,
  /^(openai|ai|@anthropic-ai\/.*|@ai-sdk\/.*|@google\/generative-ai|@aws-sdk\/client-bedrock.*)$/,
  /(^|[/.-])(provider|providers|cassette|cassettes|budget-ledger|budget)([/.-]|$)/i,
];
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
        if (FORBIDDEN_SPECIFIER_PARTS.some((re) => re.test(spec))) offenders.push(`${rel(f)}: ${spec}`);
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
});
