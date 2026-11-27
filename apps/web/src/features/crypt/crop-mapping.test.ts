import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cropFrame, hotspotUnionBounds, mapCropPoint, type Bounds } from './crop-mapping';

const SCENE = { width: 1920, height: 1080 };

describe('hotspotUnionBounds', () => {
  it('is the bounding box of all points', () => {
    const bounds = hotspotUnionBounds([
      [{ x: 0.2, y: 0.4 }, { x: 0.3, y: 0.6 }],
      [{ x: 0.5, y: 0.3 }, { x: 0.4, y: 0.7 }],
    ]);
    expect(bounds).toEqual({ minX: 0.2, minY: 0.3, maxX: 0.5, maxY: 0.7 });
  });
  it('is the whole scene when nothing is drawn', () => {
    expect(hotspotUnionBounds([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });
});

describe('mapCropPoint examples', () => {
  const whole: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  it('matches plain scaling when the viewport has the scene aspect ratio', () => {
    const p = mapCropPoint({ x: 0.5, y: 0.25 }, SCENE, whole, { width: 960, height: 540 });
    expect(p.x).toBeCloseTo(480);
    expect(p.y).toBeCloseTo(135);
  });

  it('centres a union that fits on a narrow viewport', () => {
    // 400x800 viewport: scale 800/1080, rendered width 1422.2. Union centre x = 0.5 lands at 200.
    const bounds: Bounds = { minX: 0.45, minY: 0.3, maxX: 0.55, maxY: 0.7 };
    const p = mapCropPoint({ x: 0.5, y: 0.5 }, SCENE, bounds, { width: 400, height: 800 });
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(400);
  });

  it('never exposes an empty edge: a union at the scene edge is shifted back', () => {
    const bounds: Bounds = { minX: 0, minY: 0.3, maxX: 0.05, maxY: 0.7 };
    const p = mapCropPoint({ x: 0, y: 0.5 }, SCENE, bounds, { width: 400, height: 800 });
    expect(p.x).toBeCloseTo(0);
  });

  it('pins points outside the visible window to the viewport edge', () => {
    const bounds: Bounds = { minX: 0.45, minY: 0, maxX: 0.55, maxY: 1 };
    const p = mapCropPoint({ x: 0.99, y: 0.5 }, SCENE, bounds, { width: 400, height: 800 });
    expect(p.x).toBe(400);
  });

  it('returns the origin for a zero-sized viewport', () => {
    expect(mapCropPoint({ x: 0.5, y: 0.5 }, SCENE, whole, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('Property 7: Crop_Mapping keeps hotspot-union points inside the viewport', () => {
  // Validates: Requirements 11.3, 11.5, 24.4
  const size = fc.double({ min: 1, max: 5000, noNaN: true });
  const fraction = fc.double({ min: 0, max: 1, noNaN: true });
  const boundsArb = fc
    .tuple(fraction, fraction, fraction, fraction)
    .map(([a, b, c, d]): Bounds => ({ minX: Math.min(a, b), maxX: Math.max(a, b), minY: Math.min(c, d), maxY: Math.max(c, d) }));

  it('returns finite coordinates inside the viewport', () => {
    fc.assert(
      fc.property(size, size, size, size, boundsArb, fraction, fraction, (vw, vh, sw, sh, bounds, tx, ty) => {
        const point = {
          x: bounds.minX + tx * (bounds.maxX - bounds.minX),
          y: bounds.minY + ty * (bounds.maxY - bounds.minY),
        };
        const out = mapCropPoint(point, { width: sw, height: sh }, bounds, { width: vw, height: vh });
        expect(Number.isFinite(out.x)).toBe(true);
        expect(Number.isFinite(out.y)).toBe(true);
        expect(out.x).toBeGreaterThanOrEqual(0);
        expect(out.x).toBeLessThanOrEqual(vw);
        expect(out.y).toBeGreaterThanOrEqual(0);
        expect(out.y).toBeLessThanOrEqual(vh);
      }),
    );
  });

  it('is exact object-fit: cover placement when the union fits in the viewport', () => {
    fc.assert(
      fc.property(size, size, fraction, fraction, (vw, vh, tx, ty) => {
        const scale = Math.max(vw / SCENE.width, vh / SCENE.height);
        const bounds: Bounds = { minX: tx, maxX: tx, minY: ty, maxY: ty };
        const out = mapCropPoint({ x: tx, y: ty }, SCENE, bounds, { width: vw, height: vh });
        const rw = SCENE.width * scale;
        const rh = SCENE.height * scale;
        const ox = Math.min(Math.max(vw / 2 - tx * rw, vw - rw), 0);
        const oy = Math.min(Math.max(vh / 2 - ty * rh, vh - rh), 0);
        expect(out.x).toBeCloseTo(ox + tx * rw, 6);
        expect(out.y).toBeCloseTo(oy + ty * rh, 6);
      }),
    );
  });
});

describe('cropFrame', () => {
  const whole: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  it('fills a viewport with the scene aspect ratio', () => {
    expect(cropFrame(SCENE, whole, { width: 960, height: 540 })).toEqual({ x: 0, y: 0, width: 960, height: 540 });
  });
  it('covers a portrait viewport and centres on the bounds without exposing an edge', () => {
    const frame = cropFrame(SCENE, { minX: 0.1, minY: 0, maxX: 0.3, maxY: 1 }, { width: 390, height: 844 });
    expect(frame.height).toBeCloseTo(844);
    expect(frame.width).toBeGreaterThan(390);
    expect(frame.x).toBeLessThanOrEqual(0);
    expect(frame.x + frame.width).toBeGreaterThanOrEqual(390);
  });
  it('agrees with mapCropPoint for unclamped points', () => {
    const bounds: Bounds = { minX: 0.4, minY: 0.2, maxX: 0.6, maxY: 0.8 };
    const viewport = { width: 390, height: 844 };
    const frame = cropFrame(SCENE, bounds, viewport);
    const p = mapCropPoint({ x: 0.5, y: 0.5 }, SCENE, bounds, viewport);
    expect(p.x).toBeCloseTo(frame.x + 0.5 * frame.width);
    expect(p.y).toBeCloseTo(frame.y + 0.5 * frame.height);
  });
});
