import { createElement } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ANNOUNCEMENT_COPY } from '@escape-the-crypt/core';
import type { Outcome_Notice } from '@escape-the-crypt/core';
import { useMount } from '../../test-support/flow-dom';
import { realScene, slotOf } from '../../test-support/scene-fixtures';
import { ghostName } from './accessible-names';
import { ArtStage } from './art-stage';
import type { ArtStageProps } from './art-stage';
import { LanternProvider } from './lantern-context';

const SCENE = realScene();
const LIT = slotOf('rune-cipher', { slotId: 's1', status: 'solved', candleLit: true });
const ghost = { conceptId: 'a', returnNumber: 1 as const, due: false };

function reduceMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
function view(props: Partial<ArtStageProps>): ReactNode {
  return createElement(
    LanternProvider,
    null,
    createElement(ArtStage, {
      artRoom: 'burial-chamber',
      scene: SCENE,
      slots: [LIT],
      cleared: false,
      log: vi.fn(),
      viewport: { width: 1280, height: 720 },
      ...props,
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe.each([false, true])('the stage with reduced motion %s', (reduce) => {
  const mount = useMount();
  const stage = (): HTMLElement => mount.container.querySelector('[data-testid="art-stage"]') as HTMLElement;
  it('draws a lit candle, light and ghost with no moment when no notice names them', () => {
    reduceMotion(reduce);
    mount.render(view({ ghosts: [ghost] }));
    expect(stage().dataset.moment).toBeUndefined();
    expect(mount.container.querySelector('.flame--ignite')).toBeNull();
    expect(mount.container.querySelector('.ghost-art--rise, .ghost-art--leaving')).toBeNull();
    expect(mount.container.querySelector('.art-layer--fade-in')).toBeNull();
  });
  it('writes the moment and keeps the animation classes, so CSS decides what moves', () => {
    reduceMotion(reduce);
    const notices: Outcome_Notice[] = [
      { kind: 'candleLit', target: { type: 'slot', slotId: 's1' } },
      { kind: 'ghostSpawned', conceptId: 'a' },
    ];
    mount.render(view({ ghosts: [ghost], notices }));
    expect(stage().dataset.moment).toBe('candle-lit ghost-rises');
    expect(stage().dataset.parallax).toBe(reduce ? 'off' : 'on');
    expect(stage().dataset.reducedMotion).toBe(reduce ? 'true' : 'false');
    expect(mount.container.querySelector('.flame--ignite')).not.toBeNull();
    expect(mount.container.querySelector('.ghost-art--rise')).not.toBeNull();
  });
  it('marks a ghost laid to rest', () => {
    reduceMotion(reduce);
    mount.render(view({ ghosts: [ghost] }));
    mount.render(view({ ghosts: [], notices: [{ kind: 'ghostLaidToRest', conceptId: 'a' }] }));
    expect(stage().dataset.moment).toBe('ghost-laid-to-rest');
    expect(mount.container.querySelector('.ghost-art--leaving')).not.toBeNull();
  });
  it('still fades a ghost when its laid-to-rest notice arrives a render after it left (saved runs)', () => {
    reduceMotion(reduce);
    mount.render(view({ ghosts: [ghost] }));
    mount.render(view({ ghosts: [] }));
    expect(mount.container.querySelector('[data-ghost="a"]')?.getAttribute('data-state')).toBe('present');
    mount.render(view({ ghosts: [], notices: [{ kind: 'ghostLaidToRest', conceptId: 'a' }] }));
    expect(mount.container.querySelector('[data-ghost="a"]')?.getAttribute('data-state')).toBe('leaving');
  });
  it('drops a notice the stage does not draw', () => {
    reduceMotion(reduce);
    mount.render(view({ notices: [{ kind: 'candleLit', target: { type: 'slot', slotId: 'elsewhere' } }] }));
    expect(stage().dataset.moment).toBeUndefined();
  });
  it('keeps the text equivalent: the ghost return number is in the DOM and every moment has its sentence', () => {
    reduceMotion(reduce);
    mount.render(view({ ghosts: [ghost], notices: [{ kind: 'ghostSpawned', conceptId: 'a' }] }));
    expect(mount.container.querySelector('.ghost-art')?.getAttribute('data-return')).toBe('1');
    expect(ghostName(1)).toContain('1');
    expect(ROOM_ANNOUNCEMENT_COPY.notice.ghostSpawned.length).toBeGreaterThan(0);
    expect(ROOM_ANNOUNCEMENT_COPY.notice.candleLit.length).toBeGreaterThan(0);
    expect(ROOM_ANNOUNCEMENT_COPY.notice.ghostLaidToRest.length).toBeGreaterThan(0);
  });
});
