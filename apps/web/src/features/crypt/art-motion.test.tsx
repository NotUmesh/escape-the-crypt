import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LockSlotState, Outcome_Notice } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { realScene, slotOf } from '../../test-support/scene-fixtures';
import { ArtStage } from './art-stage';
import type { ArtStageProps } from './art-stage';
import type { GhostItem } from './ghost-list';

const SCENE = realScene();
const VIEWPORT = { width: 1280, height: 720 };
const LOG = vi.fn();

function lit(type: 'rune-cipher' | 'seance-board', over: Partial<LockSlotState> = {}): LockSlotState {
  return slotOf(type, { status: 'solved', candleLit: true, ...over });
}

function stage(mount: ReturnType<typeof useMount>, props: Partial<ArtStageProps> & Pick<ArtStageProps, 'slots'>): void {
  mount.render(
    createElement(ArtStage, {
      artRoom: 'burial-chamber',
      scene: SCENE,
      cleared: false,
      log: LOG,
      viewport: VIEWPORT,
      ...props,
    }),
  );
}

const litNotice = (slotId: string): Outcome_Notice => ({ kind: 'candleLit', target: { type: 'slot', slotId } });
const flames = (c: ParentNode, kind: string): HTMLElement[] =>
  Array.from(c.querySelectorAll<HTMLElement>(`[data-flame="${kind}"]`));

describe('flames and light passes', () => {
  const mount = useMount();

  it('draws ambient flames from the first frame, steady, with no teal', () => {
    stage(mount, { slots: [slotOf('rune-cipher')] });
    const ambient = flames(mount.container, 'ambient');
    expect(ambient).toHaveLength(SCENE.desktop.ambientCandles.length);
    for (const flame of ambient) expect(flame.dataset.ignite).toBe('false');
  });

  it('draws no flame and no light for an unlit lock', () => {
    stage(mount, { slots: [slotOf('rune-cipher')] });
    expect(flames(mount.container, 'progress')).toHaveLength(0);
    expect(mount.container.querySelectorAll('img[data-layer="light"]')).toHaveLength(0);
  });

  it('draws a lit candle with its flame and light at once, with no animation, when no notice names it', () => {
    stage(mount, { slots: [lit('rune-cipher')] });
    const [flame] = flames(mount.container, 'progress');
    expect(flame?.dataset.ignite).toBe('false');
    const light = mount.container.querySelector('img[data-layer="light"]');
    expect(light?.getAttribute('data-file')).toBe('light-rune-cipher.webp');
    expect(light?.classList.contains('art-layer--fade-in')).toBe(false);
    expect(mount.container.querySelector('.art-layer--solve-in')).toBeNull();
    expect(mount.container.querySelector('[data-transition="from"]')).toBeNull();
  });

  it('ignites the flame, fades the light in and crossfades the lock on a candleLit notice', () => {
    const slot = lit('rune-cipher');
    stage(mount, { slots: [slot], notices: [litNotice(slot.slotId)] });
    const [flame] = flames(mount.container, 'progress');
    expect(flame?.dataset.ignite).toBe('true');
    expect(flame?.className).toContain('flame--ignite');
    const light = mount.container.querySelector('img[data-layer="light"]');
    expect(light?.classList.contains('art-layer--fade-in')).toBe(true);
    const from = mount.container.querySelector('[data-transition="from"]');
    expect(from?.getAttribute('data-file')).toBe('lock-rune-cipher.webp');
    expect(from?.classList.contains('art-layer--solve-out')).toBe(true);
    expect(mount.container.querySelector('.art-layer--solve-in')?.getAttribute('data-file')).toBe(
      'lock-rune-cipher-solved.webp',
    );
  });

  it('animates only the lock the notice names and adds the light passes of all lit locks', () => {
    const a = lit('rune-cipher');
    const b = lit('seance-board');
    stage(mount, { slots: [a, b], notices: [litNotice(b.slotId)] });
    const files = Array.from(mount.container.querySelectorAll('img[data-layer="light"]')).map((i) =>
      i.getAttribute('data-file'),
    );
    expect(files.sort()).toEqual(['light-rune-cipher.webp', 'light-seance-board.webp']);
    const ignite = flames(mount.container, 'progress').map((f) => [f.dataset.lock, f.dataset.ignite]);
    expect(ignite.sort()).toEqual([
      ['rune-cipher', 'false'],
      ['seance-board', 'true'],
    ]);
  });

  it.each(['settled', 'challenged'] as const)('draws no flame and no light for a %s lock, even if candleLit is set', (status) => {
    const slot = slotOf('rune-cipher', { status, candleLit: true });
    stage(mount, { slots: [slot], notices: [litNotice(slot.slotId)] });
    expect(flames(mount.container, 'progress')).toHaveLength(0);
    expect(mount.container.querySelectorAll('img[data-layer="light"]')).toHaveLength(0);
    expect(mount.container.querySelector('[data-transition="from"]')).toBeNull();
    expect(mount.container.querySelector('img[data-layer="lock"]')?.getAttribute('data-file')).toBe(
      'lock-rune-cipher-solved.webp',
    );
  });

  it('composites light passes additively with a screen fallback', () => {
    const css = readCss('art-stage.css');
    expect(css).toMatch(/\.art-layer--light\s*\{\s*mix-blend-mode:\s*screen/);
    expect(css).toMatch(/@supports \(mix-blend-mode: plus-lighter\)[\s\S]*mix-blend-mode:\s*plus-lighter/);
  });
});

function readCss(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'features', 'crypt', name), 'utf8');
}

describe('ghosts, spirit candles and the door', () => {
  const mount = useMount();
  const ghost = (id: string, returnNumber: 1 | 2 = 1): GhostItem => ({ conceptId: id, returnNumber, due: false });
  const anchors = SCENE.desktop.ghostAnchors.length;

  it('places ghosts at anchors in order, index modulo the anchor count', () => {
    const ghosts = Array.from({ length: anchors + 1 }, (_, i) => ghost(`c${i}`));
    stage(mount, { slots: [slotOf('rune-cipher')], ghosts });
    const drawn = Array.from(mount.container.querySelectorAll<HTMLElement>('.ghost-art'));
    expect(drawn.map((g) => g.dataset.anchor)).toEqual(ghosts.map((_, i) => String(i % anchors)));
    const first = drawn[0];
    const wrapped = drawn[anchors];
    expect(first?.style.left).toBe(wrapped?.style.left);
    expect(first?.style.top).toBe(wrapped?.style.top);
  });

  it('draws a ghost with no animation from State, and rising on a ghostSpawned notice', () => {
    stage(mount, { slots: [slotOf('rune-cipher')], ghosts: [ghost('a')] });
    expect(mount.container.querySelector('.ghost-art')?.className).not.toContain('ghost-art--rise');
    stage(mount, {
      slots: [slotOf('rune-cipher')],
      ghosts: [ghost('a')],
      notices: [{ kind: 'ghostSpawned', conceptId: 'a' }],
    });
    expect(mount.container.querySelector('.ghost-art')?.className).toContain('ghost-art--rise');
  });

  it('keeps a laid-to-rest ghost at its anchor while it fades, then removes it', () => {
    vi.useFakeTimers();
    try {
      stage(mount, { slots: [slotOf('rune-cipher')], ghosts: [ghost('a'), ghost('b')] });
      stage(mount, {
        slots: [slotOf('rune-cipher')],
        ghosts: [ghost('b')],
        notices: [{ kind: 'ghostLaidToRest', conceptId: 'a' }],
      });
      const leaving = mount.container.querySelector<HTMLElement>('.ghost-art--leaving');
      expect(leaving?.dataset.ghost).toBe('a');
      expect(leaving?.dataset.anchor).toBe('0');
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(mount.container.querySelector('.ghost-art--leaving')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws ghosts and spirit flames as sight only: no pointer events, under the controls, no Light_Pass', () => {
    stage(mount, { slots: [slotOf('rune-cipher')], ghosts: [ghost('a')], spiritCandleCount: 1 });
    const layer = mount.container.querySelector('[data-testid="ghost-layer"]');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(flames(mount.container, 'spirit')).toHaveLength(1);
    expect(mount.container.querySelectorAll('img[data-layer="light"]')).toHaveLength(0);
    const css = readCss('ghost-layer.css');
    expect(css).toMatch(/\.ghost-layer\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.ghost-art\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.ghost-layer\s*\{[^}]*z-index:\s*5/);
    expect(readCss('art-stage.css')).toMatch(/\.art-stage__controls\s*\{[^}]*z-index:\s*10/);
  });

  it('ignites a spirit flame only when a spirit candleLit notice arrives', () => {
    const notice: Outcome_Notice = { kind: 'candleLit', target: { type: 'spirit', roomId: 'r' } };
    stage(mount, { slots: [slotOf('rune-cipher')], spiritCandleCount: 2, notices: [notice] });
    expect(flames(mount.container, 'spirit').map((f) => f.dataset.ignite)).toEqual(['false', 'true']);
  });

  it('draws the closed door until the room is cleared', () => {
    stage(mount, { slots: [slotOf('rune-cipher')], roomId: 'r1' });
    const files = Array.from(mount.container.querySelectorAll('img[data-layer="door"]')).map((i) =>
      i.getAttribute('data-file'),
    );
    expect(files).toEqual(['door-closed.webp']);
  });

  it('draws a cleared door open with its light at once when no notice names the room', () => {
    stage(mount, { slots: [slotOf('rune-cipher')], cleared: true, roomId: 'r1' });
    const files = Array.from(mount.container.querySelectorAll('img[data-layer="door"]')).map((i) =>
      i.getAttribute('data-file'),
    );
    expect(files).toEqual(['door-open.webp', 'light-door.webp']);
    expect(mount.container.querySelector('.art-layer--fade-in')).toBeNull();
  });

  it('crossfades the door and fades its light in on a roomCleared notice', () => {
    stage(mount, {
      slots: [slotOf('rune-cipher')],
      cleared: true,
      roomId: 'r1',
      notices: [{ kind: 'roomCleared', roomId: 'r1' }],
    });
    const door = (file: string): Element | null => mount.container.querySelector(`img[data-file="${file}"]`);
    expect(door('door-closed.webp')?.classList.contains('art-layer--fade-out')).toBe(true);
    expect(door('door-open.webp')?.classList.contains('art-layer--fade-in')).toBe(true);
    const light = door('light-door.webp');
    expect(light?.classList.contains('art-layer--fade-in')).toBe(true);
    expect(light?.classList.contains('art-layer--light')).toBe(true);
  });

  it('ignores a roomCleared notice for another room', () => {
    stage(mount, {
      slots: [slotOf('rune-cipher')],
      cleared: true,
      roomId: 'r1',
      notices: [{ kind: 'roomCleared', roomId: 'other' }],
    });
    expect(mount.container.querySelector('img[data-file="door-closed.webp"]')).toBeNull();
  });
});
