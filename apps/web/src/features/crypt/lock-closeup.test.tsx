import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LockType } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { realScene } from '../../test-support/scene-fixtures';
import { LockCloseUp, lockCloseUpPath } from './lock-closeup';
import { panelSideFor } from './panel-side';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function closeUp(
  mount: ReturnType<typeof useMount>,
  over: Partial<{ solved: boolean; side: 'left' | 'right'; phone: boolean; lockType: LockType }> = {},
  log = vi.fn(),
): void {
  mount.render(
    createElement(
      LockCloseUp,
      {
        lockType: 'rune-cipher',
        solved: false,
        side: 'right',
        phone: false,
        log,
        ...over,
        children: createElement('section', { className: 'question-panel' }, 'panel'),
      },
    ),
  );
}

describe('panelSideFor', () => {
  it('reads the panelSide of the lock entry in the scene', () => {
    const scene = realScene();
    for (const [type, entry] of Object.entries(scene.desktop.locks)) {
      expect(panelSideFor(scene, type as LockType, false)).toBe(entry.panelSide);
    }
  });
  it('gives right without a scene or an entry', () => {
    expect(panelSideFor(null, 'rune-cipher', false)).toBe('right');
  });
});

describe('LockCloseUp', () => {
  const mount = useMount();

  it('opens on the side it is given', () => {
    closeUp(mount, { side: 'left' });
    expect(mount.container.querySelector('[data-testid="lock-closeup"]')?.getAttribute('data-side')).toBe('left');
    closeUp(mount, { side: 'right' });
    expect(mount.container.querySelector('[data-testid="lock-closeup"]')?.getAttribute('data-side')).toBe('right');
  });

  it('shows closed.webp for an open slot and open.webp for a solved slot, with empty alt', () => {
    closeUp(mount, { lockType: 'seance-board', solved: false });
    const closed = mount.container.querySelector('img');
    expect(closed?.getAttribute('src')).toBe('/art/locks/seance-board/closed.webp');
    expect(closed?.getAttribute('alt')).toBe('');
    closeUp(mount, { lockType: 'seance-board', solved: true });
    expect(mount.container.querySelector('img')?.getAttribute('src')).toBe('/art/locks/seance-board/open.webp');
  });

  it.each(['bone-ordering', 'bound-threads', 'combination-dial', 'cursed-object'] as const)(
    '%s shows closed art for an open slot, open art for a solved one, and logs one failed load',
    (type) => {
      closeUp(mount, { lockType: type, solved: false });
      expect(mount.container.querySelector('img')?.getAttribute('src')).toBe(`/art/locks/${type}/closed.webp`);
      closeUp(mount, { lockType: type, solved: true });
      expect(mount.container.querySelector('img')?.getAttribute('src')).toBe(`/art/locks/${type}/open.webp`);
      const log = vi.fn();
      closeUp(mount, { lockType: type, solved: false }, log);
      act(() => {
        mount.container.querySelector('img')?.dispatchEvent(new Event('error'));
      });
      expect(log).toHaveBeenCalledTimes(1);
    },
  );
  it('names a file that exists for every lock type and state', () => {
    for (const type of ['rune-cipher', 'seance-board', 'bone-ordering', 'bound-threads', 'cursed-object', 'combination-dial'] as const) {
      for (const solved of [false, true]) {
        const file = join(ROOT, 'public', lockCloseUpPath(type, solved));
        expect(() => readFileSync(file)).not.toThrow();
      }
    }
  });

  it('logs one message and draws nothing when the art fails, and keeps the panel', () => {
    const log = vi.fn();
    closeUp(mount, {}, log);
    const img = mount.container.querySelector('img');
    act(() => {
      img?.dispatchEvent(new Event('error'));
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('/art/locks/rune-cipher/closed.webp', 'art-load-failed');
    expect(mount.container.querySelector('img')).toBeNull();
    expect(mount.container.querySelector('.question-panel')).not.toBeNull();
  });

  it('marks a Phone_Viewport and the CSS gives the panel the full width there', () => {
    closeUp(mount, { phone: true });
    const root = mount.container.querySelector('[data-testid="lock-closeup"]');
    expect(root?.getAttribute('data-phone')).toBe('true');
    expect(root?.classList.contains('lock-closeup--phone')).toBe(true);
    closeUp(mount, { phone: false });
    expect(mount.container.querySelector('[data-testid="lock-closeup"]')?.getAttribute('data-phone')).toBe('false');
    const css = readFileSync(join(HERE, 'lock-closeup.css'), 'utf8');
    expect(css).toMatch(/\.lock-closeup--phone \.lock-closeup__panel\s*\{\s*width:\s*100%/);
  });
});

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('panel contrast over the art', () => {
  const tokens = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
  const token = (name: string): string => {
    const found = new RegExp(`--${name}:\\s*(\\S+);`).exec(tokens)?.[1];
    if (found === undefined) throw new Error(`no token ${name}`);
    return found;
  };

  it('draws the panel on an opaque token surface, so the art never lowers its contrast', () => {
    const css = readFileSync(join(HERE, 'question-panel.css'), 'utf8');
    expect(css).toMatch(/\.question-panel\s*\{[^}]*background:\s*var\(--stone-800\)/);
    expect(css).toMatch(/\.question-panel\s*\{[^}]*color:\s*var\(--bone-50\)/);
    const closeUpCss = readFileSync(join(HERE, 'lock-closeup.css'), 'utf8');
    expect(closeUpCss).not.toMatch(/\.lock-closeup__panel\s*\{[^}]*opacity/);
  });

  it('keeps text on that surface at 4.5:1 or more', () => {
    expect(contrast(token('bone-50'), token('stone-800'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('stone-300'), token('stone-800'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-900'), token('parchment-100'))).toBeGreaterThanOrEqual(4.5);
  });
});
