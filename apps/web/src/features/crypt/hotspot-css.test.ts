import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the order-independence of the art hotspot over the plain-list lock button.
const DIR = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

/** Specificity as [ids, classes/attributes/pseudo-classes, types]; enough for the simple selectors used here. */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/:where\([^)]*\)/g, '').replace(/::?[a-z-]+\(([^)]*)\)/g, (m) => m.slice(0, m.indexOf('(')) + ' ');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[a-z-]+/g) ?? []).length;
  const types = (s.replace(/\.[\w-]+|\[[^\]]*\]|#[\w-]+|::?[a-z-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, types];
}
const higher = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/** Flat rule list: selector and body of every non-at-rule block (media blocks are flattened). */
function parseRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
    const selector = (m[1] ?? '').trim();
    if (!selector.startsWith('@')) rules.push({ selector, body: m[2] ?? '' });
  }
  return rules;
}

function declared(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of parseRules(css)) {
    if (!rule.selector.split(',').some((p) => p.trim() === selector)) continue;
    for (const d of rule.body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  return out;
}

describe('art hotspot beats the plain-list button regardless of CSS order', () => {
  const art = read('art-stage.css');
  const plain = read('room-screen.css');
  const HOTSPOT = '.room-screen__lock-button.room-hotspot';

  it('has an override selector with higher specificity than every plain button rule it fights', () => {
    const plainRules = parseRules(plain).filter((r) => r.selector.split(',').some((p) => p.trim() === '.room-screen__lock-button'));
    expect(plainRules.length).toBeGreaterThan(0);
    expect(higher(specificity(HOTSPOT), specificity('.room-screen__lock-button'))).toBe(true);
    expect(higher(specificity(HOTSPOT), specificity('.room-hotspot'))).toBe(true);
  });

  it('clears every visible property the plain button rule sets', () => {
    const decl = declared(art, HOTSPOT);
    expect(decl.get('background')).toBe('transparent');
    expect(decl.get('border')).toBe('0');
    expect(decl.get('padding')).toBe('0');
    expect(decl.get('box-shadow')).toBe('none');
    // Not weakened with !important, and the 44px floor is not overridden here.
    expect(art).not.toMatch(/!important/);
    expect(decl.has('min-width')).toBe(false);
  });

  it('keeps the plain-list rule styled and the focus ring on hotspots', () => {
    const base = declared(plain, '.room-screen__lock-button');
    expect(base.get('background')).toBe('var(--stone-800)');
    expect(base.get('border')).toBe('1px solid var(--stone-300)');
    expect(declared(art, `${HOTSPOT}:focus-visible`).get('outline')).toBe('var(--focus-ring)');
  });
});

