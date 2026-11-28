import { describe, expect, it } from 'vitest';
import type { LockType } from '@escape-the-crypt/core';
import { hotspotUnionBounds, mapCropPoint } from './crop-mapping';
import { MIN_HIT_PX } from './hotspot-geometry';
import { fitBoxInside, isPhoneViewport, layoutScene, partitionDrawnSlots } from './scene-layout';
import { realScene, slotOf } from '../../test-support/scene-fixtures';
import type { SceneFile } from './scene-types';

const ALL: readonly LockType[] = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
];
const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

describe('isPhoneViewport', () => {
  it('is true below an aspect ratio of 0.75', () => {
    expect(isPhoneViewport(PHONE)).toBe(true);
    expect(isPhoneViewport({ width: 750, height: 1000 })).toBe(false);
    expect(isPhoneViewport(DESKTOP)).toBe(false);
  });
});

describe('layoutScene on a desktop stage', () => {
  const scene = realScene();
  const layout = layoutScene(scene, ALL.map((t) => slotOf(t)), DESKTOP, false);

  it('emits buttons left to right (tab order)', () => {
    const xs = layout.locks.map((l) => l.hotspotCenterX);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(layout.locks).toHaveLength(6);
  });

  it('stacks the lock with the smaller depth on top', () => {
    const depths = layout.stacked.map((l) => l.depth);
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
  });

  it('keeps every box at least 44 by 44 px and inside the stage', () => {
    for (const { box } of layout.locks) {
      expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_PX);
      expect(box.height).toBeGreaterThanOrEqual(MIN_HIT_PX);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(DESKTOP.width);
    }
  });

  it('is not cropped and uses the desktop set', () => {
    expect(layout.cropped).toBe(false);
    expect(layout.directory).toBe('desktop');
    expect(layout.frame).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
});

it('covers a non-native desktop ratio and projects the stock hotspot in the same frame', () => {
  const scene = realScene();
  const stage = { width: 1280, height: 800 };
  const layout = layoutScene(scene, [slotOf('rune-cipher')], stage, false, true);
  const { frame } = layout;
  expect(frame.height).toBe(stage.height);
  expect(frame.width / frame.height).toBeCloseTo(scene.desktop.size[0] / scene.desktop.size[1]);
  expect(frame.width).toBeGreaterThan(stage.width);
  expect(frame.x).toBeLessThanOrEqual(0);
  expect(frame.x + frame.width).toBeGreaterThanOrEqual(stage.width);
  const point = scene.desktop.locks['rune-cipher']?.hotspot[0];
  if (point === undefined) throw new Error('Missing stock rune hotspot');
  const actual = layout.locks[0]?.polygon[0];
  expect(actual?.x).toBeCloseTo(frame.x + point[0] * frame.width);
  expect(actual?.y).toBeCloseTo(frame.y + point[1] * frame.height);
});

describe('layoutScene on a phone stage without a mobile block', () => {
  const scene = realScene();
  const slots = [slotOf('rune-cipher'), slotOf('seance-board')];
  const layout = layoutScene(scene, slots, PHONE, true);
  const sceneSize = { width: scene.desktop.size[0], height: scene.desktop.size[1] };
  const toPoints = (p: readonly (readonly [number, number])[]) => p.map(([x, y]) => ({ x, y }));
  const bounds = hotspotUnionBounds(
    slots.map((s) => toPoints((scene.desktop.locks[s.stationType] as { hotspot: [number, number][] }).hotspot)),
  );

  it('crops the desktop art', () => {
    expect(scene.mobile).toBeUndefined();
    expect(layout.cropped).toBe(true);
    expect(layout.directory).toBe('desktop');
  });

  it('maps the candle, ambient candles, ghost anchors and door through mapCropPoint', () => {
    const rune = layout.locks.find((l) => l.lockType === 'rune-cipher');
    const candle = scene.desktop.locks['rune-cipher']?.candle;
    expect(rune?.candle.x).toBeCloseTo(mapCropPoint({ x: candle?.x ?? 0, y: candle?.y ?? 0 }, sceneSize, bounds, PHONE).x);
    const first = scene.desktop.ambientCandles[0];
    expect(layout.ambientCandles[0]).toMatchObject(mapCropPoint({ x: first?.x ?? 0, y: first?.y ?? 0 }, sceneSize, bounds, PHONE));
    const anchor = scene.desktop.ghostAnchors[0];
    expect(layout.ghostAnchors[0]).toEqual(mapCropPoint(anchor ?? { x: 0, y: 0 }, sceneSize, bounds, PHONE));
    const doorPoints = toPoints(scene.desktop.door.hotspot).map((p) => mapCropPoint(p, sceneSize, bounds, PHONE));
    expect(layout.door.polygon).toEqual(doorPoints);
  });

  it('keeps every box at least 44 by 44 px and fully inside the viewport', () => {
    for (const { box } of layout.locks) {
      expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_PX);
      expect(box.height).toBeGreaterThanOrEqual(MIN_HIT_PX);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    }
  });

  it('keeps boxes reachable even when the union is wider than the screen', () => {
    const all = layoutScene(scene, ALL.map((t) => slotOf(t)), PHONE, true);
    for (const { box } of all.locks) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_PX);
    }
  });
});

describe('layoutScene with a mobile block', () => {
  it('reads the mobile block and the mobile art set on a phone only', () => {
    const base = realScene();
    const scene: SceneFile = { ...base, mobile: { ...base.desktop, size: [1080, 1920] } };
    expect(layoutScene(scene, [slotOf('rune-cipher')], PHONE, true).directory).toBe('mobile');
    expect(layoutScene(scene, [slotOf('rune-cipher')], DESKTOP, false).directory).toBe('desktop');
  });
});

describe('partitionDrawnSlots', () => {
  const scene = realScene();
  it('draws only the types the room holds and keeps the first slot of a type', () => {
    const a = slotOf('rune-cipher', { slotId: 'a' });
    const b = slotOf('rune-cipher', { slotId: 'b' });
    const { drawn, undrawn } = partitionDrawnSlots(scene, [a, b]);
    expect(drawn.map((s) => s.slotId)).toEqual(['a']);
    expect(undrawn.map((s) => s.slotId)).toEqual(['b']);
  });

  it('leaves a slot without a scene entry to the plain list', () => {
    const sparse: SceneFile = { ...scene, desktop: { ...scene.desktop, locks: { 'rune-cipher': scene.desktop.locks['rune-cipher']! } } };
    const { drawn, undrawn } = partitionDrawnSlots(sparse, [slotOf('rune-cipher'), slotOf('seance-board')]);
    expect(drawn.map((s) => s.stationType)).toEqual(['rune-cipher']);
    expect(undrawn.map((s) => s.stationType)).toEqual(['seance-board']);
  });
});

describe('fitBoxInside', () => {
  it('moves a box in and never goes below 44 px', () => {
    expect(fitBoxInside({ x: -22, y: 10, width: 44, height: 50 }, PHONE)).toEqual({ x: 0, y: 10, width: 44, height: 50 });
    expect(fitBoxInside({ x: 380, y: 10, width: 44, height: 50 }, PHONE)).toEqual({ x: 346, y: 10, width: 44, height: 50 });
    expect(fitBoxInside({ x: 0, y: 0, width: 900, height: 50 }, PHONE).width).toBe(390);
  });
});
