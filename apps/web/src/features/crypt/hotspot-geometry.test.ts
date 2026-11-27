import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_HIT_PX, hotspotBox, sealPoints, stackOrder, tabOrder, type ViewportPoint } from './hotspot-geometry';

const pt = (x: number, y: number): ViewportPoint => ({ x, y });

/** Strict point-in-polygon (even-odd). */
function inside(polygon: readonly ViewportPoint[], p: ViewportPoint): boolean {
  let result = false;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] as ViewportPoint;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) result = !result;
  });
  return result;
}

const CONVEX = [pt(100, 50), pt(300, 60), pt(340, 200), pt(200, 280), pt(90, 180)];
// L shape: the centroid height (about 32) crosses only the narrow leg.
const L_SHAPE = [pt(0, 0), pt(100, 0), pt(100, 20), pt(20, 20), pt(20, 100), pt(0, 100)];
const C_SHAPE = [pt(0, 0), pt(100, 0), pt(100, 20), pt(20, 20), pt(20, 80), pt(100, 80), pt(100, 100), pt(0, 100)];

describe('sealPoints', () => {
  for (const [name, polygon] of [
    ['convex', CONVEX],
    ['L-shaped', L_SHAPE],
    ['C-shaped', C_SHAPE],
  ] as const) {
    for (let count = 0; count <= 8; count += 1) {
      it(`returns ${count} points inside a ${name} polygon, left to right`, () => {
        const points = sealPoints(polygon, count);
        expect(points).toHaveLength(count);
        for (const p of points) expect(inside(polygon, p)).toBe(true);
        for (let i = 1; i < points.length; i += 1) {
          expect((points[i] as ViewportPoint).x).toBeGreaterThan((points[i - 1] as ViewportPoint).x);
        }
      });
    }
  }

  it('spaces points at (i + 1) / (count + 1) along the widest interval', () => {
    const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)];
    expect(sealPoints(square, 3)).toEqual([pt(25, 50), pt(50, 50), pt(75, 50)]);
  });

  it('falls back to a nearby crossing height when the centroid height only touches a horizontal edge', () => {
    // Two squares joined at one horizontal edge height: centroid y = 50 sits on the shared edge level.
    const stepped = [pt(0, 0), pt(100, 0), pt(100, 50), pt(40, 50), pt(40, 100), pt(0, 100)];
    const points = sealPoints(stepped, 4);
    expect(points).toHaveLength(4);
    for (const p of points) expect(inside(stepped, p)).toBe(true);
  });

  it('scans at the centroid height and takes the only interval for an L shape', () => {
    const points = sealPoints(L_SHAPE, 1);
    expect(points).toHaveLength(1);
    expect((points[0] as ViewportPoint).y).toBeGreaterThan(20);
    expect((points[0] as ViewportPoint).x).toBeCloseTo(10);
  });
});

describe('stackOrder and tabOrder examples', () => {
  const locks = [
    { id: 'a', depth: 5, hotspotCenterX: 300 },
    { id: 'b', depth: 2, hotspotCenterX: 100 },
    { id: 'c', depth: 5, hotspotCenterX: 100 },
    { id: 'd', depth: 9, hotspotCenterX: 200 },
  ];

  it('stackOrder lists the smallest depth last (on top) and keeps ties stable', () => {
    expect(stackOrder(locks).map((l) => l.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('tabOrder is ascending x and keeps ties stable', () => {
    expect(tabOrder(locks).map((l) => l.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('does not mutate the input', () => {
    const copy = locks.map((l) => ({ ...l }));
    stackOrder(locks);
    tabOrder(locks);
    expect(locks).toEqual(copy);
  });
});

describe('hotspotBox examples', () => {
  it('grows a small polygon about its centre', () => {
    expect(hotspotBox([pt(100, 100), pt(110, 100), pt(110, 110)])).toEqual({ x: 83, y: 83, width: MIN_HIT_PX, height: MIN_HIT_PX });
  });
  it('keeps a large polygon at its bounding box', () => {
    expect(hotspotBox([pt(10, 20), pt(210, 20), pt(110, 120)])).toEqual({ x: 10, y: 20, width: 200, height: 100 });
  });
});

const coord = fc.double({ min: -2000, max: 4000, noNaN: true });
const viewportPoint = fc.record({ x: coord, y: coord });

describe('Property 5: A hotspot box is never smaller than 44 by 44 px', () => {
  // Validates: Requirements 10.2, 11.6
  it('is at least 44 by 44 and contains the polygon bounding box', () => {
    fc.assert(
      fc.property(fc.array(viewportPoint, { minLength: 1, maxLength: 12 }), (polygon) => {
        const box = hotspotBox(polygon);
        expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_PX);
        expect(box.height).toBeGreaterThanOrEqual(MIN_HIT_PX);
        const eps = 1e-6;
        for (const p of polygon) {
          expect(p.x).toBeGreaterThanOrEqual(box.x - eps);
          expect(p.x).toBeLessThanOrEqual(box.x + box.width + eps);
          expect(p.y).toBeGreaterThanOrEqual(box.y - eps);
          expect(p.y).toBeLessThanOrEqual(box.y + box.height + eps);
        }
      }),
    );
  });
});

describe('Property 6: Stacking order follows depth and tab order follows x', () => {
  // Validates: Requirements 10.4, 10.5
  const lockArb = fc.array(
    fc.record({
      id: fc.uuid(),
      depth: fc.double({ min: -100, max: 100, noNaN: true }),
      hotspotCenterX: fc.double({ min: -1000, max: 3000, noNaN: true }),
    }),
    { maxLength: 15 },
  );

  it('returns permutations, depth-sorted with smaller depth on top, x non-decreasing, no mutation', () => {
    fc.assert(
      fc.property(lockArb, (locks) => {
        const before = JSON.stringify(locks);
        const stacked = stackOrder(locks);
        const tabbed = tabOrder(locks);
        expect(JSON.stringify(locks)).toBe(before);
        const ids = locks.map((l) => l.id).sort();
        expect(stacked.map((l) => l.id).sort()).toEqual(ids);
        expect(tabbed.map((l) => l.id).sort()).toEqual(ids);
        // Last item is on top, so depth is non-increasing from first to last.
        for (let i = 1; i < stacked.length; i += 1) {
          expect((stacked[i] as { depth: number }).depth).toBeLessThanOrEqual((stacked[i - 1] as { depth: number }).depth);
        }
        for (let i = 1; i < tabbed.length; i += 1) {
          expect((tabbed[i] as { hotspotCenterX: number }).hotspotCenterX).toBeGreaterThanOrEqual(
            (tabbed[i - 1] as { hotspotCenterX: number }).hotspotCenterX,
          );
        }
      }),
    );
  });
});

