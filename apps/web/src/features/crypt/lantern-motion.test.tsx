import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { realScene, slotOf } from '../../test-support/scene-fixtures';
import { ArtStage } from './art-stage';
import { LANTERN_STORAGE_KEY } from './lantern-setting';
import { LanternProvider } from './lantern-context';
import { LanternToggle } from './lantern-toggle';
import { MAX_PARALLAX_PX, pointerOffset, tiltOffset } from './use-parallax';

const SCENE = realScene();

function mockReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function room(mount: ReturnType<typeof useMount>, withToggle = false): void {
  mount.render(
    createElement(
      LanternProvider,
      null,
      createElement(ArtStage, {
        artRoom: 'burial-chamber',
        scene: SCENE,
        slots: [slotOf('rune-cipher')],
        cleared: false,
        log: vi.fn(),
        viewport: { width: 1280, height: 720 },
      }),
      withToggle ? createElement(LanternToggle, { label: 'test label' }) : null,
    ),
  );
}

const stageOf = (c: ParentNode): HTMLElement => {
  const el = c.querySelector<HTMLElement>('[data-testid="art-stage"]');
  if (el === null) throw new Error('no stage');
  return el;
};

describe('parallax', () => {
  const mount = useMount();

  it('exposes the Scene_File factors and moves with the pointer, by a few pixels', () => {
    mockReducedMotion(false);
    room(mount);
    const stage = stageOf(mount.container);
    expect(stage.dataset.parallax).toBe('on');
    expect(stage.style.getPropertyValue('--parallax-background')).toBe(String(SCENE.desktop.parallax.background));
    expect(stage.style.getPropertyValue('--parallax-locks')).toBe(String(SCENE.desktop.parallax.locks));
    expect(stage.style.getPropertyValue('--parallax-foreground')).toBe(String(SCENE.desktop.parallax.foreground));
    act(() => {
      stage.dispatchEvent(new MouseEvent('pointermove', { clientX: window.innerWidth, clientY: 0, bubbles: true }));
    });
    expect(Number(stage.style.getPropertyValue('--parallax-x'))).toBe(1);
    expect(Number(stage.style.getPropertyValue('--parallax-y'))).toBe(-1);
    expect(MAX_PARALLAX_PX).toBeLessThanOrEqual(8);
  });

  it('follows device tilt', () => {
    mockReducedMotion(false);
    room(mount);
    const stage = stageOf(mount.container);
    act(() => {
      const event = new Event('deviceorientation') as Event & { gamma: number; beta: number };
      event.gamma = 15;
      event.beta = 45;
      window.dispatchEvent(event);
    });
    expect(Number(stage.style.getPropertyValue('--parallax-x'))).toBeCloseTo(0.5);
  });

  it('turns parallax off under prefers-reduced-motion: reduce', () => {
    mockReducedMotion(true);
    room(mount);
    const stage = stageOf(mount.container);
    expect(stage.dataset.parallax).toBe('off');
    expect(stage.dataset.reducedMotion).toBe('true');
    act(() => {
      stage.dispatchEvent(new MouseEvent('pointermove', { clientX: window.innerWidth, clientY: 0, bubbles: true }));
    });
    expect(Number(stage.style.getPropertyValue('--parallax-x'))).toBe(0);
  });

  it('keeps the offsets inside -1..1', () => {
    expect(pointerOffset(5000, -5000, 1000, 500)).toEqual({ x: 1, y: -1 });
    expect(pointerOffset(1, 1, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(tiltOffset(200, -200)).toEqual({ x: 1, y: -1 });
    expect(tiltOffset(null, null)).toEqual({ x: 0, y: 0 });
  });
});

describe('Lantern_Mode start value', () => {
  const mount = useMount();

  it('starts off with no stored value and no reduced motion', () => {
    mockReducedMotion(false);
    room(mount);
    expect(stageOf(mount.container).dataset.lantern).toBe('false');
  });

  it('starts on under reduced motion when nothing is stored', () => {
    mockReducedMotion(true);
    room(mount);
    expect(stageOf(mount.container).dataset.lantern).toBe('true');
  });

  it('lets a stored off beat reduced motion, and a stored on beat its absence', () => {
    mockReducedMotion(true);
    window.localStorage.setItem(LANTERN_STORAGE_KEY, 'off');
    room(mount);
    expect(stageOf(mount.container).dataset.lantern).toBe('false');
  });

  it('starts on from a stored on', () => {
    mockReducedMotion(false);
    window.localStorage.setItem(LANTERN_STORAGE_KEY, 'on');
    room(mount);
    expect(stageOf(mount.container).dataset.lantern).toBe('true');
  });
});

describe('Lantern_Mode overlays and toggle', () => {
  const mount = useMount();
  const overlay = (c: ParentNode): HTMLElement | null => c.querySelector('[data-testid="atmosphere"]');
  const toggle = (c: ParentNode): HTMLButtonElement => {
    const b = c.querySelector<HTMLButtonElement>('button.lantern-toggle');
    if (b === null) throw new Error('no toggle');
    return b;
  };

  it('draws darkness, vignette, grain and mist with the pointer ignored, below the controls', () => {
    mockReducedMotion(false);
    room(mount);
    const layer = overlay(mount.container);
    expect(layer).not.toBeNull();
    for (const part of ['darkness', 'vignette', 'grain', 'mist']) {
      expect(layer?.querySelector(`.atmosphere__${part}`)).not.toBeNull();
    }
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
  });

  it('removes every overlay in Lantern_Mode', () => {
    mockReducedMotion(true);
    room(mount);
    expect(overlay(mount.container)).toBeNull();
    expect(mount.container.querySelector('[class*="atmosphere__"]')).toBeNull();
  });

  it('is a native button with aria-pressed that writes the setting and removes the overlays', () => {
    mockReducedMotion(false);
    room(mount, true);
    const button = toggle(mount.container);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    act(() => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(LANTERN_STORAGE_KEY)).toBe('on');
    expect(overlay(mount.container)).toBeNull();
    act(() => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem(LANTERN_STORAGE_KEY)).toBe('off');
    expect(overlay(mount.container)).not.toBeNull();
  });

  it('keeps the session value silently when the write throws', () => {
    mockReducedMotion(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    room(mount, true);
    const before = mount.container.textContent;
    act(() => toggle(mount.container).click());
    expect(toggle(mount.container).getAttribute('aria-pressed')).toBe('true');
    expect(overlay(mount.container)).toBeNull();
    expect(mount.container.textContent).toBe(before);
  });
});

describe('atmosphere and motion CSS', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const atmosphere = readFileSync(join(dir, 'atmosphere-layer.css'), 'utf8');
  const stage = readFileSync(join(dir, 'art-stage.css'), 'utf8');

  it('gives the layer and every part pointer-events: none and no flashing or shaking', () => {
    expect(atmosphere).toMatch(/\.atmosphere\s*\{[^}]*pointer-events:\s*none/);
    expect(atmosphere).toMatch(/\.atmosphere > span\s*\{[^}]*pointer-events:\s*none/);
    expect(atmosphere).not.toMatch(/shake|blink|strobe/i);
  });

  it('stops the mist drift, flicker and parallax transitions under reduced motion', () => {
    expect(atmosphere).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.atmosphere__mist\s*\{\s*animation:\s*none/);
    expect(stage).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none/);
  });
});
