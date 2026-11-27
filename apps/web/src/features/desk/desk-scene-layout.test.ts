import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESK_ANCHOR_Y,
  DESK_ART_SIZE,
  DESK_BOOK_POINT,
  DESK_CANDLE_POINT,
  coverPoint,
  deskSetFor,
} from './desk-scene-layout';

const PUBLIC = join(process.cwd(), 'public');

describe('deskSetFor', () => {
  it('uses the mobile set for portrait windows and the desktop set otherwise', () => {
    expect(deskSetFor({ width: 390, height: 844 })).toBe('mobile');
    expect(deskSetFor({ width: 1280, height: 720 })).toBe('desktop');
    expect(deskSetFor({ width: 800, height: 1000 })).toBe('desktop');
    expect(deskSetFor({ width: 0, height: 0 })).toBe('desktop');
  });
});

describe('coverPoint', () => {
  it('is the identity scaled when the box has the source aspect', () => {
    const p = coverPoint({ x: 960, y: 540 }, DESK_ART_SIZE.desktop, { width: 960, height: 540 }, 0.5);
    expect(p.x).toBeCloseTo(480);
    expect(p.y).toBeCloseTo(270);
  });

  it('crops the sides of a wide image in a tall box, centred', () => {
    // 1920x1080 in a 540x1080 box: scale 1, drawn 1920 wide, offset -690.
    const p = coverPoint({ x: 960, y: 540 }, DESK_ART_SIZE.desktop, { width: 540, height: 1080 }, 0.5);
    expect(p.x).toBeCloseTo(270);
    expect(p.y).toBeCloseTo(540);
  });

  it('keeps the top of a tall image when anchored to the top', () => {
    const p = coverPoint({ x: 540, y: 100 }, DESK_ART_SIZE.mobile, { width: 540, height: 600 }, 0);
    expect(p.y).toBeCloseTo(100 * 0.5);
  });

  it('returns the origin for an empty box instead of NaN', () => {
    expect(coverPoint({ x: 1, y: 1 }, DESK_ART_SIZE.desktop, { width: 0, height: 0 }, 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('desk constants', () => {
  it('keeps every point inside its art set', () => {
    for (const set of ['desktop', 'mobile'] as const) {
      for (const point of [DESK_CANDLE_POINT[set], DESK_BOOK_POINT[set]]) {
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(DESK_ART_SIZE[set].width);
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(DESK_ART_SIZE[set].height);
      }
      expect(DESK_ANCHOR_Y[set]).toBeGreaterThanOrEqual(0);
    }
  });

  it('points at art files that exist', () => {
    const files = [
      'desk/desktop/background.webp',
      'desk/desktop/background@2x.webp',
      'desk/desktop/candle.webp',
      'desk/desktop/foreground.webp',
      'desk/mobile/background.webp',
      'desk/mobile/candle.webp',
      'desk/books/book-1.webp',
      'desk/books/book-2.webp',
      'desk/books/book-3.webp',
      'desk/books/book-4.webp',
    ];
    for (const file of files) expect(existsSync(join(PUBLIC, 'art', file)), file).toBe(true);
  });
});
