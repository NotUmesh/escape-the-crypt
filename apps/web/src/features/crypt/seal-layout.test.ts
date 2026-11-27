import { describe, expect, it } from 'vitest';
import { realScene } from '../../test-support/scene-fixtures';
import { MIN_HIT_PX, sealPoints } from './hotspot-geometry';
import type { ViewportPoint } from './hotspot-geometry';
import { layoutScene } from './scene-layout';
import { placeSeals } from './seal-layout';

function inside(polygon: readonly ViewportPoint[], p: ViewportPoint): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

const SCENE = realScene();
const realDoor = (width: number): readonly ViewportPoint[] =>
  layoutScene(SCENE, [], { width, height: (width * 1080) / 1920 }, false).door.polygon;
const NARROW: readonly ViewportPoint[] = [
  { x: 100, y: 0 },
  { x: 160, y: 0 },
  { x: 160, y: 400 },
  { x: 100, y: 400 },
];

describe('placeSeals', () => {
  for (const [name, polygon] of [
    ['the real door at 1280 px', realDoor(1280)],
    ['the real door at 900 px', realDoor(900)],
    ['the real door at 600 px', realDoor(600)],
    ['a narrow door', NARROW],
  ] as const) {
    for (let count = 0; count <= 8; count += 1) {
      it(`puts ${count} seals inside ${name}, in slot order, with no two 44 px controls overlapping`, () => {
        const seals = placeSeals(polygon, count);
        if (seals === null) {
          // Only a door too small for the count may refuse, never the full-size desktop door.
          expect(name).not.toBe('the real door at 1280 px');
          return;
        }
        expect(seals).toHaveLength(count);
        for (const seal of seals) expect(inside(polygon, seal)).toBe(true);
        const xs = seals.map((s) => s.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        for (let i = 0; i < seals.length; i += 1) {
          for (let j = i + 1; j < seals.length; j += 1) {
            const a = seals[i];
            const b = seals[j];
            if (a === undefined || b === undefined) continue;
            const apart = Math.abs(a.x - b.x) >= MIN_HIT_PX || Math.abs(a.y - b.y) >= MIN_HIT_PX;
            expect(apart).toBe(true);
          }
        }
      });
    }
  }

  it('refuses a door that cannot hold the seals', () => {
    const tiny: readonly ViewportPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 60 },
      { x: 0, y: 60 },
    ];
    expect(placeSeals(tiny, 6)).toBeNull();
  });

  it('uses the plain sealPoints when the door is wide enough', () => {
    const wide: readonly ViewportPoint[] = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 300 },
      { x: 0, y: 300 },
    ];
    const placed = (placeSeals(wide, 3) ?? []).map(({ x, y }) => ({ x, y }));
    expect(placed).toEqual(sealPoints(wide, 3));
  });
});
