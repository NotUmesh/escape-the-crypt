export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const MIN_HIT_PX = 44;

/** Bounding box of the polygon in viewport px, grown about its centre to at least 44x44. */
export function hotspotBox(polygon: readonly ViewportPoint[]): Box {
  if (polygon.length === 0) return { x: 0, y: 0, width: MIN_HIT_PX, height: MIN_HIT_PX };
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, MIN_HIT_PX);
  const height = Math.max(maxY - minY, MIN_HIT_PX);
  return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2, width, height };
}

/** Smaller depth = on top (Req 10.4). Returned bottom-first, so the last item is on top. Stable; does not mutate. */
export function stackOrder<T extends { depth: number }>(locks: readonly T[]): readonly T[] {
  return [...locks].sort((a, b) => b.depth - a.depth);
}

/** Ascending hotspot-centre x (Req 10.5). Stable; does not mutate. */
export function tabOrder<T extends { hotspotCenterX: number }>(locks: readonly T[]): readonly T[] {
  return [...locks].sort((a, b) => a.hotspotCenterX - b.hotspotCenterX);
}

type Interval = readonly [number, number];

function centroidY(polygon: readonly ViewportPoint[]): number {
  let area2 = 0;
  let cy = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] as ViewportPoint;
    const cross = p.x * q.y - q.x * p.y;
    area2 += cross;
    cy += (p.y + q.y) * cross;
  });
  if (Math.abs(area2) < 1e-12) return polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  return cy / (3 * area2);
}

/** Interior intervals of the polygon along the horizontal line at `y` (even-odd rule, half-open edges). */
function intervalsAt(polygon: readonly ViewportPoint[], y: number): Interval[] {
  const xs: number[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] as ViewportPoint;
    if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
  });
  xs.sort((a, b) => a - b);
  const out: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    if (b > a) out.push([a, b]);
  }
  return out;
}

function widest(intervals: readonly Interval[]): Interval | null {
  let best: Interval | null = null;
  for (const iv of intervals) if (best === null || iv[1] - iv[0] > best[1] - best[0]) best = iv;
  return best;
}

/**
 * `count` points inside `polygon` on one horizontal scan line (Req 19.4), left to right,
 * at fractions (i + 1) / (count + 1) of the widest interior interval.
 */
export function sealPoints(polygon: readonly ViewportPoint[], count: number): readonly ViewportPoint[] {
  if (count <= 0 || polygon.length === 0) return [];
  const cy = centroidY(polygon);
  let y = cy;
  let interval = widest(intervalsAt(polygon, cy));
  if (interval === null) {
    // Centroid line misses the interior: try midpoints between vertex heights, nearest first.
    const levels = [...new Set(polygon.map((p) => p.y))].sort((a, b) => a - b);
    const mids = levels.slice(1).map((v, i) => ((levels[i] as number) + v) / 2);
    mids.sort((a, b) => Math.abs(a - cy) - Math.abs(b - cy));
    for (const m of mids) {
      const found = widest(intervalsAt(polygon, m));
      if (found !== null) {
        y = m;
        interval = found;
        break;
      }
    }
  }
  if (interval === null) {
    const x = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
    return Array.from({ length: count }, () => ({ x, y: cy }));
  }
  const [left, right] = interval;
  return Array.from({ length: count }, (_, i) => ({ x: left + ((right - left) * (i + 1)) / (count + 1), y }));
}
