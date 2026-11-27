import { MIN_HIT_PX, sealPoints } from './hotspot-geometry';
import type { ViewportPoint } from './hotspot-geometry';

/** A seal's point, and which side of it the label goes so labels stay clear of other seals. */
export interface PlacedSeal extends ViewportPoint {
  readonly labelAbove: boolean;
}

/** Vertical step between rows of seals: a 44 px control and a 2 px gap. */
const ROW_STEP_PX = MIN_HIT_PX + 2;

function insidePolygon(polygon: readonly ViewportPoint[], p: ViewportPoint): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function overlaps(a: ViewportPoint, b: ViewportPoint): boolean {
  return Math.abs(a.x - b.x) < MIN_HIT_PX && Math.abs(a.y - b.y) < MIN_HIT_PX;
}

/**
 * Seals at the `sealPoints` of the door, one per slot in slot order. A door can be narrower than
 * `count` controls of 44 px, so when neighbours would overlap the seals are spread over several rows
 * (same x, shifted y), each kept inside the door polygon (Requirement 19.4).
 * Returns null when no layout keeps every seal inside the door with its own 44 px control; the caller
 * then draws the plain list so every seal stays reachable.
 */
export function placeSeals(polygon: readonly ViewportPoint[], count: number): readonly PlacedSeal[] | null {
  const base = sealPoints(polygon, count);
  const first = base[0];
  const second = base[1];
  const gap = first === undefined || second === undefined ? Infinity : Math.abs(second.x - first.x);
  const rows = Math.max(1, Math.min(count, Math.ceil(MIN_HIT_PX / Math.max(gap, 1))));
  const placed = base.map((point, index): PlacedSeal => {
    const offset = ((index % rows) - (rows - 1) / 2) * ROW_STEP_PX;
    return { x: point.x, y: point.y + offset, labelAbove: offset < 0 };
  });
  for (let i = 0; i < placed.length; i += 1) {
    const a = placed[i];
    if (a === undefined || !insidePolygon(polygon, a)) return null;
    for (let j = i + 1; j < placed.length; j += 1) {
      const b = placed[j];
      if (b !== undefined && overlaps(a, b)) return null;
    }
  }
  return placed;
}