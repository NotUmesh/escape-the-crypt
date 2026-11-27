import { describe, expect, it } from 'vitest';

// Static check (Req 12.10, 21.3): nothing in P2/P3 mentions the evaluation results folder.
// The forbidden path is assembled from parts so this file never matches itself.
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

// here = <repo>/packages/core/src/cassette
const coreSrc = here.replace(/\/[^/]*$/, '');
const repoRoot = coreSrc.replace(/\/packages\/core\/src$/, '');
const workerSrc = `${repoRoot}/apps/worker/src`;

// P4 extends this deliberately with its results-writer path: the Evaluation_Skill's path module,
// relative to apps/worker/src. Every other P2/P3 file stays out of the results folder.
const ALLOWLIST: readonly string[] = ['evaluation/paths.ts'];

const FORBIDDEN = [
  ['eval', 'results'].join('/'),
  ['eval', 'results'].join('\\'),
];

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

const self = `${here}/no-eval-results-writes.test.ts`;
const coreFiles = listTs(coreSrc);
const workerFiles = listTs(workerSrc);

function offenders(files: string[], root: string): string[] {
  return files
    .filter((f) => f !== self)
    .filter((f) => !ALLOWLIST.includes(f.slice(root.length + 1)))
    .filter((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return FORBIDDEN.some((p) => text.includes(p));
    })
    .map((f) => f.slice(root.length + 1));
}

describe('no writes to the evaluation results folder (Req 12.10, 21.3)', () => {
  it('scans a non-trivial set of files in both roots', () => {
    expect(coreFiles.length).toBeGreaterThan(20);
    expect(workerFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('no packages/core/src file mentions the results folder', () => {
    expect(offenders(coreFiles, coreSrc)).toEqual([]);
  });

  it('no apps/worker/src file mentions the results folder', () => {
    expect(offenders(workerFiles, workerSrc)).toEqual([]);
  });

  it('the allowlist holds only the P4 Evaluation_Skill path module', () => {
    expect(ALLOWLIST).toEqual(['evaluation/paths.ts']);
  });
});
