import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { ghostName } from './accessible-names';
import { GhostList } from './ghost-list';
import type { GhostItem } from './ghost-list';

const GHOSTS: readonly GhostItem[] = [
  { conceptId: 'a', returnNumber: 1, due: false },
  { conceptId: 'b', returnNumber: 2, due: true },
  { conceptId: 'c', returnNumber: 1, due: false },
];

describe('GhostList', () => {
  const mount = useMount();

  it('renders nothing without ghosts or spirit candles', () => {
    mount.render(createElement(GhostList, { ghosts: [] }));
    expect(mount.container.querySelector('[data-testid="ghost-list"]')).toBeNull();
  });

  it('names each ghost by return number and marks only not-yet-due ghosts as returning later', () => {
    mount.render(createElement(GhostList, { ghosts: GHOSTS, anchorCount: 2 }));
    const items = Array.from(mount.container.querySelectorAll('li'));
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain(ghostName(1));
    expect(items[1]?.textContent).toContain(ghostName(2));
    expect(items[0]?.textContent).toContain(ROOM_PLAY_LABELS.ghostReturnsLater);
    expect(items[1]?.textContent).not.toContain(ROOM_PLAY_LABELS.ghostReturnsLater);
    expect(items.map((li) => li.getAttribute('data-anchor'))).toEqual(['0', '1', '0']);
  });

  it('shows lit spirit candles as text with a hidden flame marker', () => {
    mount.render(createElement(GhostList, { ghosts: [], spiritCandleCount: 2 }));
    expect(mount.container.textContent).toContain(ROOM_PLAY_LABELS.spiritCandlesLit(2));
    expect(mount.container.textContent).toContain('Spirit candles lit: 2');
    expect(mount.container.querySelector('.ghost-list__flame')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses the singular text for one spirit candle', () => {
    mount.render(createElement(GhostList, { ghosts: [], spiritCandleCount: 1 }));
    expect(mount.container.querySelector('.ghost-list__spirit')?.textContent).toContain(ROOM_PLAY_LABELS.spiritCandleLit);
    expect(mount.container.textContent).not.toContain('Spirit candles lit');
  });

  it('declares pointer-events: none for the ghost layer', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'features', 'crypt', 'room-screen.css'), 'utf8');
    expect(css).toMatch(/\.ghost-list\s*\{[^}]*pointer-events:\s*none/);
  });
});
