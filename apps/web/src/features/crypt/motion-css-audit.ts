/**
 * A small static audit of motion in a stylesheet. Test support only: it reads CSS text and returns
 * findings as `selector: reason`, and it changes nothing.
 */
export type MotionMedia = 'reduce' | 'no-preference' | null;
export interface FlatRule {
  readonly selectors: readonly string[];
  readonly body: string;
  readonly media: MotionMedia;
  readonly keyframes: string | null;
}
/** Slow loops that set a mood and carry no outcome. Each must still stop under reduced motion. */
const AMBIENT_LOOPS: ReadonlySet<string> = new Set([
  'flame-flicker',
  'ghost-drift',
  'atmosphere-drift',
  'dig-mist-drift',
  'dig-speck-fall',
]);
const ANIMATABLE: ReadonlySet<string> = new Set([
  'opacity',
  'transform',
  'filter',
  'stroke-dashoffset',
  'clip-path',
  'background-position',
]);
const KEYWORDS = new Set([
  'infinite', 'alternate', 'alternate-reverse', 'reverse', 'normal', 'forwards', 'backwards', 'both', 'none',
  'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'paused', 'running',
]);

function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
export function flattenCss(css: string): FlatRule[] {
  const out: FlatRule[] = [];
  const source = strip(css);
  const stack: { prelude: string }[] = [];
  let buffer = '';
  const context = (): { media: MotionMedia; keyframes: string | null } => {
    let media: MotionMedia = null;
    let keyframes: string | null = null;
    for (const frame of stack) {
      if (/prefers-reduced-motion:\s*reduce/.test(frame.prelude)) media = 'reduce';
      else if (/prefers-reduced-motion:\s*no-preference/.test(frame.prelude)) media = 'no-preference';
      const k = /^@keyframes\s+([\w-]+)/.exec(frame.prelude);
      if (k?.[1] !== undefined) keyframes = k[1];
    }
    return { media, keyframes };
  };
  for (const ch of source) {
    if (ch === '{') {
      stack.push({ prelude: buffer.trim() });
      buffer = '';
    } else if (ch === '}') {
      const frame = stack.pop();
      if (frame !== undefined && buffer.trim() !== '' && !frame.prelude.startsWith('@media')) {
        const { media, keyframes } = context();
        out.push({
          selectors: frame.prelude.split(',').map((s) => s.trim()),
          body: buffer.trim(),
          media,
          keyframes: keyframes ?? (frame.prelude.startsWith('@keyframes') ? null : null),
        });
      }
      buffer = '';
    } else buffer += ch;
  }
  return out;
}
function declarations(body: string): [string, string][] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':'))
    .map((d) => {
      const at = d.indexOf(':');
      return [d.slice(0, at).trim(), d.slice(at + 1).trim()] as [string, string];
    });
}
interface Anim {
  readonly name: string;
  readonly ms: number;
  readonly infinite: boolean;
  readonly count: number;
}
function parseAnimations(value: string): Anim[] {
  return value.split(/,(?![^(]*\))/).map((part) => {
    const tokens = part.trim().split(/\s+/);
    let name = '';
    let ms: number | null = null;
    let count = 1;
    let infinite = false;
    for (const t of tokens) {
      const time = /^(\d*\.?\d+)(ms|s)$/.exec(t);
      if (time?.[1] !== undefined) {
        if (ms === null) ms = Number(time[1]) * (time[2] === 's' ? 1000 : 1);
      } else if (t === 'infinite') infinite = true;
      else if (/^\d+$/.test(t)) count = Number(t);
      else if (/^[a-z][\w-]*$/.test(t) && !KEYWORDS.has(t) && !t.startsWith('cubic') && name === '') name = t;
    }
    return { name, ms: ms ?? 0, infinite, count };
  });
}
/** Findings for one stylesheet. An empty list means every motion has a still equivalent. */
export function auditCss(css: string): string[] {
  const rules = flattenCss(css);
  const findings: string[] = [];
  const reduceOff = new Set<string>();
  for (const r of rules) {
    if (r.media !== 'reduce' || r.keyframes !== null) continue;
    const off = declarations(r.body).some(([p, v]) => (p === 'animation' || p === 'transition') && v === 'none');
    if (off) for (const s of r.selectors) reduceOff.add(s);
  }
  const startsInvisible = new Set<string>();
  for (const r of rules) {
    if (r.keyframes === null) continue;
    for (const [p, v] of declarations(r.body)) {
      if (!ANIMATABLE.has(p)) findings.push(`@keyframes ${r.keyframes}: animates ${p}, which is not allowed`);
      if (p === 'opacity' && v === '0' && /^(from|0%)$/.test(r.selectors[0] ?? '')) startsInvisible.add(r.keyframes);
    }
  }
  for (const r of rules) {
    if (r.keyframes !== null) continue;
    for (const [prop, value] of declarations(r.body)) {
      const isAnimation = prop === 'animation' || prop === 'animation-name';
      const isTransition = prop === 'transition';
      if (!isAnimation && !isTransition) continue;
      if (value === 'none' || /^0s?\b/.test(value)) continue;
      const anims = isAnimation ? parseAnimations(value) : [];
      const label = r.selectors.join(', ');
      // The stage writes data-parallax="off" under reduced motion, so `[data-parallax='on']` is a gate too.
      const gated = r.selectors.every((s) => s.includes("[data-parallax='on']"));
      const hasStill = r.media === 'no-preference' || gated || r.selectors.every((s) => reduceOff.has(s));
      if (r.media !== 'reduce' && !hasStill) findings.push(`${label}: ${prop} has no reduced-motion rule`);
      for (const a of anims) {
        if (a.name === '' || AMBIENT_LOOPS.has(a.name)) continue;
        if (a.ms > 1000) findings.push(`${label}: ${a.name} lasts ${a.ms} ms, over 1000 ms`);
        if (a.infinite || a.count > 1) findings.push(`${label}: ${a.name} repeats`);
        if (startsInvisible.has(a.name) && /opacity:\s*0\b/.test(r.body)) {
          findings.push(`${label}: ${a.name} starts invisible and the resting style is hidden`);
        }
      }
    }
  }
  return findings;
}
