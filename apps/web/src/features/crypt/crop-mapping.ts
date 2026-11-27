export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** A point in scene fractions, 0..1 on each axis. */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/** A box in scene fractions. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const WHOLE_SCENE: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

/** Bounding box, in scene fractions, of every drawn lock's hotspot. The whole scene when there are none. */
export function hotspotUnionBounds(hotspots: readonly (readonly ScenePoint[])[]): Bounds {
  const points = hotspots.flat();
  if (points.length === 0) return WHOLE_SCENE;
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Offset of the scaled scene on one axis: union centre at viewport centre, never exposing an empty edge. */
function axisOffset(viewportSize: number, renderedSize: number, centreFraction: number): number {
  const wanted = viewportSize / 2 - centreFraction * renderedSize;
  return clamp(wanted, Math.min(viewportSize - renderedSize, 0), 0);
}

/** Where the scaled scene sits in the viewport, in px. `x` and `y` are never positive. */
export interface CropFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The rectangle the whole scene occupies under `object-fit: cover` centred on `bounds`.
 * Art layers are drawn into this rectangle so they line up with `mapCropPoint`.
 */
export function cropFrame(sceneSize: Viewport, bounds: Bounds, viewport: Viewport): CropFrame {
  const vw = Math.max(finiteOr(viewport.width, 0), 0);
  const vh = Math.max(finiteOr(viewport.height, 0), 0);
  const sw = finiteOr(sceneSize.width, 0);
  const sh = finiteOr(sceneSize.height, 0);
  if (sw <= 0 || sh <= 0 || vw === 0 || vh === 0) return { x: 0, y: 0, width: vw, height: vh };
  const scale = Math.max(vw / sw, vh / sh);
  const width = sw * scale;
  const height = sh * scale;
  return {
    x: axisOffset(vw, width, (finiteOr(bounds.minX, 0) + finiteOr(bounds.maxX, 1)) / 2),
    y: axisOffset(vh, height, (finiteOr(bounds.minY, 0) + finiteOr(bounds.maxY, 1)) / 2),
    width,
    height,
  };
}

/**
 * Maps a scene-fraction point to viewport px under `object-fit: cover` centred on `bounds`.
 * Pure and total. When the union is larger than the viewport, points outside the visible
 * window are pinned to the viewport edge so they stay reachable.
 */
export function mapCropPoint(point: ScenePoint, sceneSize: Viewport, bounds: Bounds, viewport: Viewport): { x: number; y: number } {
  const vw = Math.max(finiteOr(viewport.width, 0), 0);
  const vh = Math.max(finiteOr(viewport.height, 0), 0);
  const sw = finiteOr(sceneSize.width, 0);
  const sh = finiteOr(sceneSize.height, 0);
  if (sw <= 0 || sh <= 0 || vw === 0 || vh === 0) return { x: 0, y: 0 };
  const frame = cropFrame(sceneSize, bounds, viewport);
  return {
    x: clamp(frame.x + finiteOr(point.x, 0) * frame.width, 0, vw),
    y: clamp(frame.y + finiteOr(point.y, 0) * frame.height, 0, vh),
  };
}