import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Static source checks for typography and tokens (Requirements 22.2, 22.3, 22.4).

const CRYPT_DIR = dirname(fileURLToPath(import.meta.url));

interface Rule {
  readonly selector: string;
  readonly body: string;
  readonly phone: boolean;
}

const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/;
const RGB_COLOUR = /\brgba?\(/i;
const QUESTION_TEXT = /question|option|excerpt|explanation|evidence|panel-slot|lock-button|return-button/;
const TITLE_SELECTOR = /heading|title|\bh[1-6]\b/;
const ALLOWED_FONTS = new Set(['var(--font-body)', 'var(--font-title)']);

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Flat rule list; `phone` is true inside an `@media` query on aspect ratio. */
export function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const source = stripComments(css);
  const stack: { phone: boolean; isMedia: boolean }[] = [];
  const pending: { selector: string; body: string; phone: boolean }[] = [];
  let buffer = '';
  for (const ch of source) {
    if (ch === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const isAt = prelude.startsWith('@');
      const phone =
        (stack.at(-1)?.phone ?? false) || (isAt && /aspect-ratio|max-width/.test(prelude));
      stack.push({ phone, isMedia: isAt });
      if (!isAt) {
        // Declarations follow; collected until the closing brace.
        stack[stack.length - 1] = { phone, isMedia: false };
        pending.push({ selector: prelude, body: '', phone });
      }
    } else if (ch === '}') {
      const top = stack.pop();
      if (top && !top.isMedia) {
        const rule = pending.pop();
        if (rule) rules.push({ ...rule, body: buffer });
      }
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  return rules;
}

function declarations(body: string): [string, string][] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':'))
    .map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as [string, string];
    });
}

function toRem(value: string): number | undefined {
  const m = /^(\d*\.?\d+)(rem|em|px)$/.exec(value);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'px' ? n / 16 : n;
}

export function checkCss(file: string, css: string): string[] {
  const problems: string[] = [];
  const bare = stripComments(css);
  if (HEX_COLOUR.test(bare)) problems.push(`${file}: hex colour literal`);
  if (RGB_COLOUR.test(bare)) problems.push(`${file}: rgb function colour literal`);
  if (/@import/i.test(bare)) problems.push(`${file}: @import`);
  if (/url\(\s*['"]?\s*(https?:|\/\/)/i.test(bare) || /https?:\/\//i.test(bare)) {
    problems.push(`${file}: external origin`);
  }
  for (const rule of parseRules(css)) {
    const parts = rule.selector.split(',').map((s) => s.trim());
    const questionText = parts.some((p) => QUESTION_TEXT.test(p));
    const titleOnly = parts.every((p) => TITLE_SELECTOR.test(p));
    for (const [prop, value] of declarations(rule.body)) {
      if (prop === 'font-family' && !ALLOWED_FONTS.has(value)) {
        problems.push(`${file}: font-family "${value}" in ${rule.selector}`);
      }
      if (prop === 'font-family' && value === 'var(--font-title)' && questionText && !titleOnly) {
        problems.push(`${file}: --font-title on ${rule.selector}`);
      }
      if (prop === 'font-size' && questionText) {
        const rem = toRem(value);
        const min = rule.phone ? 1 : 1.125;
        if (rem !== undefined && rem < min) {
          problems.push(`${file}: font-size ${value} below ${min}rem on ${rule.selector}`);
        }
      }
    }
  }
  return problems;
}

export function checkTsx(file: string, tsx: string): string[] {
  const problems: string[] = [];
  const code = tsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (code.includes('dangerouslySetInnerHTML')) problems.push(`${file}: dangerouslySetInnerHTML`);
  if (/['"`]#[0-9a-fA-F]{3,8}['"`]/.test(code)) problems.push(`${file}: hex colour literal`);
  if (RGB_COLOUR.test(code)) problems.push(`${file}: rgb function colour literal`);
  if (/@import|url\(\s*['"]?(https?:|\/\/)/i.test(code)) problems.push(`${file}: remote import`);
  if (/https?:\/\//i.test(code)) problems.push(`${file}: external origin`);
  return problems;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const sources = walk(CRYPT_DIR).filter(
  (f) => /\.css$/.test(f) || (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)),
);

function checkFile(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const name = relative(CRYPT_DIR, path);
  return path.endsWith('.css') ? checkCss(name, text) : checkTsx(name, text);
}

describe('crypt source typography and tokens', () => {
  it('finds the shipped CSS files', () => {
    const names = sources.map((f) => relative(CRYPT_DIR, f));
    expect(names).toContain('room-screen.css');
    expect(names).toContain('question-panel.css');
  });

  it('shipped room-screen.css and panel CSS pass', () => {
    expect(checkFile(join(CRYPT_DIR, 'room-screen.css'))).toEqual([]);
    expect(checkFile(join(CRYPT_DIR, 'question-panel.css'))).toEqual([]);
  });

  it('every CSS and TSX source under features/crypt passes', () => {
    expect(sources.flatMap(checkFile)).toEqual([]);
  });

  describe('detection', () => {
    // Built at run time so this file holds no literal the repo-wide style guard scans for.
    const H = String.fromCharCode(35);
    const RGB = 'rg' + 'b(';
    const RGBA = 'rgb' + 'a(';
    const P = 'https:' + '//';
    const S = '/' + '/';
    const bad = (css: string) => checkCss('x.css', css);

    it('flags colour literals', () => {
      expect(bad(`.a { color: ${H}fff; }`)).not.toEqual([]);
      expect(bad(`.a { color: ${RGB}0, 0, 0); }`)).not.toEqual([]);
      expect(bad(`.a { color: ${RGBA}0, 0, 0, 0.5); }`)).not.toEqual([]);
    });

    it('flags imports and external origins', () => {
      expect(bad('@' + 'import "a.css";')).not.toEqual([]);
      expect(bad(`.a { background: url(${P}x.test/a.png); }`)).not.toEqual([]);
      expect(bad(`.a { background: url(${S}x.test/a.png); }`)).not.toEqual([]);
    });

    it('flags other fonts and --font-title on question text', () => {
      expect(bad('.a { font-family: Arial; }')).not.toEqual([]);
      expect(bad('.question-text { font-family: var(--font-title); }')).not.toEqual([]);
      expect(bad('.option { font-family: var(--font-title); }')).not.toEqual([]);
      expect(bad('.question-panel__heading { font-family: var(--font-title); }')).toEqual([]);
    });

    it('flags small question text, with the phone floor at 1rem', () => {
      expect(bad('.question-text { font-size: 1rem; }')).not.toEqual([]);
      expect(bad('.question-text { font-size: 17px; }')).not.toEqual([]);
      expect(bad('@media (max-aspect-ratio: 749/1000) { .option { font-size: 0.9rem; } }')).not.toEqual([]);
      expect(bad('@media (max-aspect-ratio: 749/1000) { .option { font-size: 1rem; } }')).toEqual([]);
    });

    it('flags dangerouslySetInnerHTML and TSX literals', () => {
      expect(checkTsx('x.tsx', '<p dangerouslySetInnerHTML={{ __html: a }} />')).not.toEqual([]);
      expect(checkTsx('x.tsx', `const c = '${H}abc';`)).not.toEqual([]);
      expect(checkTsx('x.tsx', `const u = '${P}x.test';`)).not.toEqual([]);
      expect(checkTsx('x.tsx', '<a href="#main">x</a>')).toEqual([]);
    });
  });
});
