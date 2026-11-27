export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type DeskSet = 'desktop' | 'mobile';

/** Source size of each art set, in px. */
export const DESK_ART_SIZE: Readonly<Record<DeskSet, Size>> = {
  desktop: { width: 1920, height: 1080 },
  mobile: { width: 1080, height: 1920 },
};

/**
 * Where the base of the desk candle's flame sits in each art set, in source px. Measured from the
 * alpha of `candle.webp`: the candle body's box, with the flame base about a third of the way
 * down it. The flame is drawn in code, so a few px of error is only cosmetic.
 */
export const DESK_CANDLE_POINT: Readonly<Record<DeskSet, Point>> = {
  desktop: { x: 1318, y: 612 },
  mobile: { x: 897, y: 1033 },
};

/** Where the open book sits (source px), the origin of the push-in on "Bring your notes". */
export const DESK_BOOK_POINT: Readonly<Record<DeskSet, Point>> = {
  desktop: { x: 990, y: 690 },
  mobile: { x: 570, y: 1110 },
};

/** The art set for a window: portrait windows use the mobile set. */
export function deskSetFor(viewport: Size): DeskSet {
  return viewport.height > 0 && viewport.width / viewport.height < 0.75 ? 'mobile' : 'desktop';
}

/** The scale `object-fit: cover` gives a source image in a box. 0 for an empty box. */
export function coverScale(source: Size, box: Size): number {
  if (source.width <= 0 || source.height <= 0 || box.width <= 0 || box.height <= 0) return 0;
  return Math.max(box.width / source.width, box.height / source.height);
}

/**
 * Maps a point of a source image drawn with `object-fit: cover` into the box it fills.
 * `anchorY` is the `object-position` vertical share (0 top, 0.5 centre).
 */
export function coverPoint(point: Point, source: Size, box: Size, anchorY: number): Point {
  const scale = coverScale(source, box);
  if (scale === 0) return { x: 0, y: 0 };
  const drawnWidth = source.width * scale;
  const drawnHeight = source.height * scale;
  const offsetX = (box.width - drawnWidth) / 2;
  const offsetY = (box.height - drawnHeight) * anchorY;
  return { x: offsetX + point.x * scale, y: offsetY + point.y * scale };
}

/** Vertical `object-position` share per set: the phone keeps the top of the art. */
export const DESK_ANCHOR_Y: Readonly<Record<DeskSet, number>> = { desktop: 0.5, mobile: 0 };
