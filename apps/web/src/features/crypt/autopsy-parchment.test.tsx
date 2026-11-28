import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildHumanHeartSampleCrypt, ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import type { HumanHeartQuestionsFile, SampleCryptResult, State } from '@escape-the-crypt/core';
import { useRoomBinding } from '../../state/room-binding';
import type { RoomBinding } from '../../state/room-binding';
import { useMount } from '../../test-support/flow-dom';
import { AutopsyView } from './autopsy-view';
import { auditCss } from './motion-css-audit';

type Rgb = readonly [number, number, number];
const CRYPT_DIR = join(process.cwd(), 'src', 'features', 'crypt');
const TOKENS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');
const CSS = readFileSync(join(CRYPT_DIR, 'final-door.css'), 'utf8');
const PARCHMENT = CSS.slice(CSS.indexOf('Autopsy_Parchment'));

function token(name: string): Rgb {
  const hex = new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`).exec(TOKENS)?.[1];
  if (hex === undefined) throw new Error(`token ${name} not found`);
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance([r, g, b]: Rgb): number {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function ratio(a: string, b: string): number {
  const la = luminance(token(a));
  const lb = luminance(token(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('Autopsy parchment tokens', () => {
  it('ink on parchment is at least 4.5:1', () => expect(ratio('--ink-900', '--parchment-100')).toBeGreaterThanOrEqual(4.5));
  it('parchment on ink (buttons) is at least 4.5:1', () => expect(ratio('--parchment-100', '--ink-900')).toBeGreaterThanOrEqual(4.5));
  it('the focus ring on parchment is at least 3:1', () => {
    expect(TOKENS).toMatch(/--focus-ring-on-light:\s*2px solid var\(--ink-900\)/);
    expect(ratio('--ink-900', '--parchment-100')).toBeGreaterThanOrEqual(3);
  });
});

describe('Autopsy parchment CSS', () => {
  it('is a labelled section and keeps the file under 300 lines', () => {
    expect(PARCHMENT.length).toBeGreaterThan(200);
    expect(CSS.split('\n').length).toBeLessThan(300);
  });
  it('fades only under no-preference and stops when focus is inside', () => {
    expect(PARCHMENT).toMatch(/prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*\.autopsy-view\s*\{[^}]*animation:\s*autopsy-open 600ms/);
    expect(PARCHMENT).toMatch(/\.autopsy-view:focus-within\s*\{\s*animation:\s*none/);
    expect(auditCss(CSS)).toEqual([]);
  });
  it('gives every button a 44 px floor and the ink focus ring', () => {
    expect(PARCHMENT).toMatch(/\.autopsy-view button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/);
    expect(PARCHMENT).toMatch(/\.autopsy-view button:focus-visible\s*\{[^}]*var\(--focus-ring-on-light\)/);
  });
  it('lays each outcome out as a row, the label left and the count right', () => {
    expect(PARCHMENT).toMatch(/\.autopsy-counts li\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/);
    expect(PARCHMENT).toMatch(/\.autopsy-outcome\s*\{[^}]*display:\s*inline-flex[^}]*gap:/);
  });
  it('uses no gold or ember on the parchment', () => {
    expect(PARCHMENT).not.toMatch(/--candle-400|--ember-600/);
  });
});

describe('AutopsyView in the DOM', () => {
  const SAMPLES = join(process.cwd(), '..', '..', 'samples');
  const notes = readFileSync(join(SAMPLES, 'human-heart.txt'), 'utf8');
  const file = JSON.parse(readFileSync(join(SAMPLES, 'questions', 'human-heart.json'), 'utf8')) as HumanHeartQuestionsFile;
  const built = buildHumanHeartSampleCrypt(notes, file);
  const crypt = (built.ok ? built.value : null) as SampleCryptResult;
  let binding: RoomBinding;
  function Harness(): ReactNode {
    binding = useRoomBinding(() => ({ ok: true, value: crypt }));
    if (binding.state === null) return null;
    const state: State = { ...binding.state, status: 'escaped' };
    return createElement(AutopsyView, { state, assets: binding.assets, dispatch: vi.fn() });
  }
  const mount = useMount();
  it('keeps the heading, the counts, the entries and Play again', () => {
    mount.render(createElement(Harness));
    act(() => binding.dispatch({ type: 'startRun' }));
    const view = mount.container.querySelector('[data-testid="autopsy-view"]') as HTMLElement;
    expect(view.querySelector('h2')?.textContent).toBe(ROOM_PLAY_LABELS.autopsyHeading);
    expect(view.querySelectorAll('[data-testid^="autopsy-count-"]')).toHaveLength(5);
    expect(view.querySelectorAll('.autopsy-entry').length).toBeGreaterThan(0);
    expect(Array.from(view.querySelectorAll('button')).some((b) => b.textContent === ROOM_PLAY_LABELS.playAgain)).toBe(true);
  });
  it('puts the quill beside the heading and hides it from assistive technology', () => {
    mount.render(createElement(Harness));
    act(() => binding.dispatch({ type: 'startRun' }));
    const head = mount.container.querySelector('.autopsy-view__head') as HTMLElement;
    expect(Array.from(head.children).map((c) => c.tagName.toLowerCase())).toEqual(['h2', 'svg']);
    expect(head.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
