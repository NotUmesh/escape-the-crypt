import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type GuardRule, scanFile } from './style-guard-rules';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PUBLIC_DIR = join(WEB_ROOT, 'public');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-e2e', 'test-results', 'fixtures']);
const SKIP_FILES = new Set([
  'src/features/ingest/style-guard.test.ts',
  'src/features/ingest/style-guard-rules.ts',
  'src/styles/tokens.test.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.(?:css|tsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const fileExists = (publicPath: string): boolean => existsSync(join(PUBLIC_DIR, publicPath));

function rules(path: string, content: string): GuardRule[] {
  return scanFile(path, content, { fileExists }).map((v) => v.rule);
}

const INGEST_CSS = 'apps/web/src/features/ingest/ingest-ui.css';
const INGEST_TSX = 'apps/web/src/features/ingest/Panel.tsx';
const OTHER_CSS = 'apps/web/src/features/crypt/crypt.css';
const OTHER_TSX = 'apps/web/src/features/crypt/Room.tsx';
const TOKENS = 'apps/web/src/styles/tokens.css';
const FONTS = 'apps/web/src/styles/fonts.css';

describe('style guard: real files', () => {
  const files = walk(WEB_ROOT).filter((f) => !SKIP_FILES.has(relative(WEB_ROOT, f).replace(/\\/g, '/')));

  it('finds files to scan', () => {
    expect(files.some((f) => f.endsWith('fonts.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('tokens.css'))).toBe(true);
  });

  it('reports no violations in any .css/.ts/.tsx file under apps/web', () => {
    const problems = files.flatMap((f) => {
      const rel = `apps/web/${relative(WEB_ROOT, f).replace(/\\/g, '/')}`;
      return scanFile(rel, readFileSync(f, 'utf8'), { fileExists }).map(
        (v) => `${rel}: ${v.rule} (${v.detail})`,
      );
    });
    expect(problems).toEqual([]);
  });
});

describe('style guard: app-wide negative tests', () => {
  const colourFixtures: Record<string, string> = {
    hex: 'a { color: #fff; }',
    rgb: 'a { color: rgb(1 2 3); }',
    rgba: 'a { color: rgba(1, 2, 3, .5); }',
    hsl: 'a { color: hsl(10 20% 30%); }',
    hsla: 'a { color: hsla(10, 20%, 30%, .5); }',
    hwb: 'a { color: hwb(10 20% 30%); }',
    lab: 'a { color: lab(50% 10 10); }',
    lch: 'a { color: lch(50% 10 10); }',
    oklab: 'a { color: oklab(50% 0.1 0.1); }',
    oklch: 'a { color: oklch(50% 0.1 10); }',
    'color()': 'a { color: color(srgb 1 0 0); }',
    'named colour': 'a { background-color: red; }',
  };

  for (const [name, css] of Object.entries(colourFixtures)) {
    it(`fails on a ${name} colour literal outside tokens.css`, () => {
      expect(rules(OTHER_CSS, css)).toContain('colour-literal');
      expect(rules(INGEST_CSS, css)).toContain('colour-literal');
      expect(rules(FONTS, css)).toContain('colour-literal');
    });
    it(`allows a ${name} colour literal inside tokens.css`, () => {
      expect(rules(TOKENS, css)).not.toContain('colour-literal');
    });
  }

  it('fails on a colour literal in TSX', () => {
    expect(rules(OTHER_TSX, 'const s = { color: "#fff" };')).toContain('colour-literal');
    expect(rules(OTHER_TSX, 'const s = { background: "tomato" };')).toContain('colour-literal');
  });

  it('allows tokens, transparent, currentColor and inherit', () => {
    const css = 'a { color: var(--bone-50); background-color: transparent; border-color: currentColor; outline: inherit; }';
    expect(rules(OTHER_CSS, css)).toEqual([]);
  });

  it('fails on a cross-origin URL anywhere, including inside ingest', () => {
    const ts = 'fetch("https://evil.example.com/x");';
    expect(rules(OTHER_TSX, ts)).toContain('cross-origin-url');
    expect(rules(INGEST_TSX, ts)).toContain('cross-origin-url');
    expect(rules(OTHER_CSS, 'a { cursor: url(//cdn.example.com/c.png); }')).toContain('cross-origin-url');
  });

  it('fails on localhost, 127.0.0.1 and example.test URLs in app source', () => {
    const urls = ['http://localhost:4173/x', 'http://127.0.0.1:3000/x', 'https://example.test/x'];
    for (const url of urls) {
      const ts = `fetch("${url}");`;
      expect(rules(INGEST_TSX, ts), url).toContain('cross-origin-url');
      expect(rules(OTHER_TSX, ts), url).toContain('cross-origin-url');
      expect(rules('apps/web/src/state/notes-store.ts', ts), url).toContain('cross-origin-url');
      expect(rules(OTHER_CSS, `a { cursor: url(${url}); }`), url).toContain('cross-origin-url');
    }
  });
  it('allows localhost, 127.0.0.1 and example.test only in config, unit-test (.ts and .tsx) and e2e files', () => {
    const ts = 'const urls = ["http://localhost:4173", "http://127.0.0.1:3000", "https://example.test/a"];';
    const allowed = [
      'apps/web/playwright.config.ts',
      'apps/web/vite.config.ts',
      'apps/web/src/features/ingest/pdf-worker-url.test.ts',
      'apps/web/src/features/ingest/ingest-ui.test.tsx',
      'apps/web/e2e/ingest-layout.e2e.ts',
    ];
    for (const file of allowed) expect(rules(file, ts), file).toEqual([]);
    // Other hosts are still rejected in those files.
    expect(rules('apps/web/e2e/ingest-layout.e2e.ts', 'const u = "https://evil.com/x";')).toContain(
      'cross-origin-url',
    );
  });
  it('allows the SVG namespace string', () => {
    expect(rules(OTHER_TSX, 'const ns = "http://www.w3.org/2000/svg";')).toEqual([]);
  });

  it('fails on a Google Fonts host', () => {
    const css = '@import url("https://fonts.googleapis.com/css2?family=Cinzel");';
    expect(rules(OTHER_CSS, css)).toContain('google-fonts');
    expect(rules(FONTS, css)).toContain('google-fonts');
    expect(rules(OTHER_TSX, 'const h = "fonts.gstatic.com";')).toContain('google-fonts');
  });

  it('fails on a fonts.css URL that is not a root-relative /fonts/*.woff2 file that exists', () => {
    const bad = [
      '@font-face { src: url("https://example.test/fonts/a.woff2"); }',
      '@font-face { src: url("fonts/cinzel-latin-400-normal.woff2"); }',
      '@font-face { src: url("/fonts/cinzel-latin-400-normal.woff"); }',
      '@font-face { src: url("/assets/cinzel-latin-400-normal.woff2"); }',
      '@font-face { src: url("/fonts/does-not-exist.woff2"); }',
    ];
    for (const css of bad) expect(rules(FONTS, css)).toContain('font-url');
  });

  it('accepts a root-relative /fonts/*.woff2 URL to an existing file', () => {
    const css = '@font-face { src: url("/fonts/cinzel-latin-400-normal.woff2") format("woff2"); }';
    expect(rules(FONTS, css)).toEqual([]);
  });
});

describe('style guard: ingest-only negative tests', () => {
  const ingestOnly: Array<[string, GuardRule, string]> = [
    ['vw unit', 'viewport-unit', '.a { width: 50vw; }'],
    ['vh unit', 'viewport-unit', '.a { height: 100vh; }'],
    ['dvh unit', 'viewport-unit', '.a { min-height: 100dvh; }'],
    ['svh unit', 'viewport-unit', '.a { min-height: 100svh; }'],
    ['position: fixed', 'position-fixed', '.a { position: fixed; }'],
    ['page background', 'page-background', 'body { background: var(--stone-950); }'],
    ['background-image', 'background-image', '.a { background-image: none; }'],
    ['url( in styles', 'url-in-ingest', '.a { list-style: url(/x.svg); }'],
    ['--candle-400 outside lit state', 'candle-outside-lit', '.a { color: var(--candle-400); }'],
  ];

  for (const [name, rule, css] of ingestOnly) {
    it(`fails on ${name} inside features/ingest`, () => {
      expect(rules(INGEST_CSS, css)).toContain(rule);
    });
    it(`passes ${name} outside features/ingest`, () => {
      expect(rules(OTHER_CSS, css)).not.toContain(rule);
    });
  }

  it('fails on position: fixed and viewport units in ingest TSX, passes elsewhere', () => {
    const tsx = 'const s = { position: "fixed", height: "100vh" };';
    expect(rules(INGEST_TSX, tsx)).toEqual(expect.arrayContaining(['position-fixed', 'viewport-unit']));
    expect(rules(OTHER_TSX, tsx)).toEqual([]);
  });

  it('allows --candle-400 inside a lit-state selector in ingest', () => {
    expect(rules(INGEST_CSS, '.ingest-root .is-lit { color: var(--candle-400); }')).toEqual([]);
    expect(rules(INGEST_CSS, '.step[data-state="lit"] { color: var(--candle-400); }')).toEqual([]);
  });

  it('flags --candle-400 in a non-lit rule that follows a lit rule', () => {
    const css = '.is-lit { color: var(--candle-400); }\n.plain { color: var(--candle-400); }';
    expect(rules(INGEST_CSS, css)).toEqual(['candle-outside-lit']);
  });

  it('does not apply ingest-only rules to files outside features/ingest', () => {
    const css =
      'body { background: var(--stone-950); background-image: url(/art/a.png); position: fixed; height: 100vh; color: var(--candle-400); }';
    expect(rules(OTHER_CSS, css)).toEqual([]);
  });
});
