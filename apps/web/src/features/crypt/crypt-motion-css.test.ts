import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditCss } from './motion-css-audit';

const DIR = dirname(fileURLToPath(import.meta.url));
const SHEETS = readdirSync(DIR).filter((f) => f.endsWith('.css'));

// Feature: haunting-polish, Property 7: Every motion has a still equivalent
describe('motion in the crypt styles', () => {
  it('finds stylesheets to audit', () => {
    expect(SHEETS.length).toBeGreaterThan(5);
  });
  for (const sheet of SHEETS) {
    it(`${sheet}: every motion has a still equivalent, is short and runs once`, () => {
      expect(auditCss(readFileSync(join(DIR, sheet), 'utf8'))).toEqual([]);
    });
  }
});

describe('the audit detects what it should', () => {
  it('flags an animation with no reduced-motion rule', () => {
    expect(auditCss('.a { animation: spin 300ms ease-out; }')).toEqual(['.a: animation has no reduced-motion rule']);
  });
  it('accepts an animation switched off under reduce', () => {
    const css = '.a { animation: spin 300ms; } @media (prefers-reduced-motion: reduce) { .a { animation: none; } }';
    expect(auditCss(css)).toEqual([]);
  });
  it('accepts an animation declared only under no-preference', () => {
    expect(auditCss('@media (prefers-reduced-motion: no-preference) { .a { animation: spin 300ms; } }')).toEqual([]);
  });
  it('flags a moment longer than 1000 ms', () => {
    const css = '@media (prefers-reduced-motion: no-preference) { .a { animation: spin 1200ms; } }';
    expect(auditCss(css)).toEqual(['.a: spin lasts 1200 ms, over 1000 ms']);
  });
  it('flags a moment that repeats, but not a named ambient loop', () => {
    const moment = '@media (prefers-reduced-motion: no-preference) { .a { animation: spin 300ms infinite; } }';
    expect(auditCss(moment)).toEqual(['.a: spin repeats']);
    const ambient = '@media (prefers-reduced-motion: no-preference) { .a { animation: flame-flicker 2.4s infinite; } }';
    expect(auditCss(ambient)).toEqual([]);
  });
  it('accepts a transition gated on the stage parallax attribute', () => {
    expect(auditCss(".s[data-parallax='on'] .a { transition: transform 100ms; }")).toEqual([]);
  });
  it('flags a keyframe that animates layout', () => {
    expect(auditCss('@keyframes k { from { width: 0; } to { width: 10px; } }')).toContain(
      '@keyframes k: animates width, which is not allowed',
    );
  });
});
