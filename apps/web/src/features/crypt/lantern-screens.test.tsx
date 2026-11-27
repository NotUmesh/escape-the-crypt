import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMount } from '../../test-support/flow-dom';
import { realScene, slotOf } from '../../test-support/scene-fixtures';
import { ArtStage } from './art-stage';
import { LanternProvider } from './lantern-context';
import { LANTERN_STORAGE_KEY } from './lantern-setting';
import { LanternToggle } from './lantern-toggle';

const SCENE = realScene();

function stubMedia(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('Lantern_Mode on the crypt stage (room and final door share it)', () => {
  const mount = useMount();
  const render = (stored: 'on' | 'off'): void => {
    window.localStorage.setItem(LANTERN_STORAGE_KEY, stored);
    stubMedia(false);
    mount.render(
      createElement(
        LanternProvider,
        null,
        createElement(ArtStage, {
          artRoom: 'burial-chamber',
          scene: SCENE,
          slots: [slotOf('rune-cipher'), slotOf('seance-board')],
          cleared: false,
          log: vi.fn(),
          viewport: { width: 1280, height: 720 },
          onActivate: () => undefined,
        }),
        createElement(LanternToggle, { label: 'Lantern mode' }),
      ),
    );
  };
  const overlay = (): Element | null => mount.container.querySelector('[data-testid="atmosphere"]');
  it('has no overlay when on', () => {
    render('on');
    expect(overlay()).toBeNull();
  });
  it('puts the overlay before the controls, so every control and ghost label paints above it', () => {
    render('off');
    const stage = mount.container.querySelector('[data-testid="art-stage"]') as HTMLElement;
    const children = Array.from(stage.children);
    const at = children.findIndex((c) => c.getAttribute('data-testid') === 'atmosphere');
    const controls = children.findIndex((c) => c.classList.contains('art-stage__controls'));
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(controls);
  });
  it('updates the stage in the same render when the mode is switched', () => {
    render('off');
    expect(overlay()).not.toBeNull();
    act(() => (mount.container.querySelector('button.lantern-toggle') as HTMLButtonElement).click());
    expect(overlay()).toBeNull();
    expect((mount.container.querySelector('[data-testid="art-stage"]') as HTMLElement).dataset.lantern).toBe('true');
  });
  it('writes only the lantern key to localStorage', () => {
    render('off');
    act(() => (mount.container.querySelector('button.lantern-toggle') as HTMLButtonElement).click());
    expect(Object.keys({ ...window.localStorage })).toEqual([LANTERN_STORAGE_KEY]);
  });
  it('keeps the same text and controls with the mode on and off', () => {
    render('off');
    const off = mount.container.textContent;
    render('on');
    expect(mount.container.textContent).toBe(off);
  });
});
