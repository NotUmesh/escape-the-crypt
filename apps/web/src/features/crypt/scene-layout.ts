import type { LockSlotState, LockType } from '@escape-the-crypt/core';
import { cropFrame, hotspotUnionBounds, mapCropPoint } from './crop-mapping';
import type { Bounds, CropFrame, ScenePoint, Viewport } from './crop-mapping';
import { MIN_HIT_PX, hotspotBox, stackOrder, tabOrder } from './hotspot-geometry';
import type { Box, ViewportPoint } from './hotspot-geometry';
import type { LockSceneEntry, SceneBlock, SceneFile } from './scene-types';

/** Phone_Viewport: width divided by height below 0.75. */
export const PHONE_ASPECT_RATIO = 0.75;

export function isPhoneViewport(viewport: Viewport): boolean {
  return viewport.height > 0 && viewport.width / viewport.height < PHONE_ASPECT_RATIO;
}

export type ArtDirectory = 'desktop' | 'mobile';

export interface DrawnLock {
  readonly slot: LockSlotState;
  readonly lockType: LockType;
  readonly depth: number;
  readonly panelSide: LockSceneEntry['panelSide'];
  /** Hotspot polygon in stage px. */
  readonly polygon: readonly ViewportPoint[];
  /** The button box in stage px: at least 44 by 44 and inside the stage. */
  readonly box: Box;
  readonly hotspotCenterX: number;
  readonly candle: { readonly x: number; readonly y: number; readonly scale: number };
}

export interface SceneLayout {
  /** True when the art is drawn with `object-fit: cover` (a Phone_Viewport). */
  readonly cropped: boolean;
  readonly directory: ArtDirectory;
  /** Where every full-frame art layer is drawn, in stage px. */
  readonly frame: CropFrame;
  /** Drawn locks in tab order (left to right). */
  readonly locks: readonly DrawnLock[];
  /** The same locks, bottom of the stack first (Requirement 10.4). */
  readonly stacked: readonly DrawnLock[];
  readonly ambientCandles: readonly { readonly x: number; readonly y: number; readonly scale: number }[];
  readonly ghostAnchors: readonly ViewportPoint[];
  readonly door: { readonly polygon: readonly ViewportPoint[]; readonly box: Box };
}

/** The slots that have a scene entry (first of each type), and the rest, which keep a plain button. */
export function partitionDrawnSlots(
  scene: SceneFile,
  slots: readonly LockSlotState[],
): { readonly drawn: readonly LockSlotState[]; readonly undrawn: readonly LockSlotState[] } {
  const seen = new Set<LockType>();
  const drawn: LockSlotState[] = [];
  const undrawn: LockSlotState[] = [];
  for (const slot of slots) {
    const inDesktop = scene.desktop.locks[slot.stationType];
    const inMobile = scene.mobile === undefined || scene.mobile.locks[slot.stationType] !== undefined;
    if (inDesktop === undefined || !inMobile || seen.has(slot.stationType)) {
      undrawn.push(slot);
      continue;
    }
    seen.add(slot.stationType);
    drawn.push(slot);
  }
  return { drawn, undrawn };
}

/** Which block to read: the `mobile` block on a phone when the file has one (Requirements 11.1, 11.2). */
export function chooseBlock(
  scene: SceneFile,
  phone: boolean,
): { readonly block: SceneBlock; readonly directory: ArtDirectory } {
  if (phone && scene.mobile !== undefined) return { block: scene.mobile, directory: 'mobile' };
  return { block: scene.desktop, directory: 'desktop' };
}

function toPoints(polygon: readonly (readonly [number, number])[]): ScenePoint[] {
  return polygon.map(([x, y]) => ({ x, y }));
}

/** Moves a box inside the stage and shrinks it to the stage, but never below 44 by 44 (Requirements 10.2, 11.6). */
export function fitBoxInside(box: Box, stage: Viewport): Box {
  const width = Math.max(MIN_HIT_PX, Math.min(box.width, stage.width));
  const height = Math.max(MIN_HIT_PX, Math.min(box.height, stage.height));
  const x = Math.min(Math.max(box.x, 0), Math.max(stage.width - width, 0));
  const y = Math.min(Math.max(box.y, 0), Math.max(stage.height - height, 0));
  return { x, y, width, height };
}
/**
 * Every coordinate in the scene, in stage px, through the one Crop_Mapping (Requirement 11.3).
 * On a desktop stage the bounds are the whole scene, so the mapping is plain scaling.
 */
export function layoutScene(
  scene: SceneFile,
  drawnSlots: readonly LockSlotState[],
  stage: Viewport,
  phone: boolean,
): SceneLayout {
  const { block, directory } = chooseBlock(scene, phone);
  const sceneSize: Viewport = { width: block.size[0], height: block.size[1] };
  const entries = drawnSlots.flatMap((slot) => {
    const entry = block.locks[slot.stationType];
    return entry === undefined ? [] : [{ slot, entry }];
  });
  const bounds: Bounds = phone
    ? hotspotUnionBounds(entries.map(({ entry }) => toPoints(entry.hotspot)))
    : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const map = (p: ScenePoint): ViewportPoint => mapCropPoint(p, sceneSize, bounds, stage);
  const drawn: DrawnLock[] = entries.map(({ slot, entry }) => {
    const polygon = toPoints(entry.hotspot).map(map);
    const xs = polygon.map((p) => p.x);
    return {
      slot,
      lockType: slot.stationType,
      depth: entry.depth,
      panelSide: entry.panelSide,
      polygon,
      box: fitBoxInside(hotspotBox(polygon), stage),
      hotspotCenterX: (Math.min(...xs) + Math.max(...xs)) / 2,
      candle: { ...map(entry.candle), scale: entry.candle.scale },
    };
  });
  const doorPolygon = toPoints(block.door.hotspot).map(map);
  return {
    cropped: phone,
    directory,
    frame: cropFrame(sceneSize, bounds, stage),
    locks: tabOrder(drawn),
    stacked: stackOrder(drawn),
    ambientCandles: block.ambientCandles.map((c) => ({ ...map(c), scale: c.scale })),
    ghostAnchors: block.ghostAnchors.map(map),
    door: { polygon: doorPolygon, box: fitBoxInside(hotspotBox(doorPolygon), stage) },
  };
}
