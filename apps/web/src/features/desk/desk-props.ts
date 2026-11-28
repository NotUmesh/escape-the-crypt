import { useEffect, useState } from 'react';
import { createArtFailureLog } from '../crypt/art-failure-log';
import type { Point, Size } from './desk-scene-layout';

export const DESK_PROPS = ['notes-book', 'crypt-stack', 'sample-chest', 'import-letter', 'crypt-stairs'] as const;
export type DeskProp = (typeof DESK_PROPS)[number];
export const DESK_ART = '/art/desk';
export const deskPropFile = (prop: DeskProp, hover = false): string => `desktop/prop-${prop}${hover ? '-hover' : ''}.webp`;

interface PropPlacement {
  readonly hotspot: readonly Point[];
  readonly label: Point;
}

export interface DeskPlacement {
  readonly size: Size;
  readonly props: ReadonlyMap<DeskProp, PropPlacement>;
  readonly candle: Point & { readonly scale: number };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function fraction(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function readDeskPlacement(raw: unknown): DeskPlacement | null {
  const scene = record(raw);
  const desktop = record(scene?.desktop);
  const size: unknown = desktop?.size;
  const props = record(desktop?.props);
  const candle = record(desktop?.candle);
  if (scene?.version !== 2 || !Array.isArray(size) || size.length !== 2 || !positive(size[0]) || !positive(size[1]) ||
      props === null || candle === null || !fraction(candle.x) || !fraction(candle.y) || !positive(candle.scale)) return null;

  const placements = new Map<DeskProp, PropPlacement>();
  for (const id of DESK_PROPS) {
    const prop = record(props[id]);
    const label = record(prop?.label);
    if (label === null || !fraction(label.x) || !fraction(label.y) || !Array.isArray(prop?.hotspot) || prop.hotspot.length < 3) return null;
    const hotspot: Point[] = [];
    for (const point of prop.hotspot as unknown[]) {
      if (!Array.isArray(point) || point.length !== 2 || !fraction(point[0]) || !fraction(point[1])) return null;
      hotspot.push({ x: point[0], y: point[1] });
    }
    placements.set(id, { hotspot, label: { x: label.x, y: label.y } });
  }
  return { size: { width: size[0], height: size[1] }, props: placements, candle: { x: candle.x, y: candle.y, scale: candle.scale } };
}

export function useDeskPlacement(enabled: boolean): DeskPlacement | null {
  const [placement, setPlacement] = useState<DeskPlacement | null>(null);
  const [log] = useState(createArtFailureLog);
  useEffect(() => {
    if (!enabled) return;
    const request = new AbortController();
    const file = `${DESK_ART}/scene.json`;
    void fetch(file, { signal: request.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Desk scene unavailable');
        const valid = readDeskPlacement(await response.json());
        if (valid === null) throw new Error('Invalid desk scene');
        if (!request.signal.aborted) setPlacement(valid);
      })
      .catch(() => {
        if (!request.signal.aborted) log(file, 'scene-load-failed');
      });
    return () => request.abort();
  }, [enabled, log]);
  return enabled ? placement : null;
}
