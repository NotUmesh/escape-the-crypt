import type { ReactNode } from 'react';
import type { LockType, SlotStatus } from '@escape-the-crypt/core';
import { ArtImage } from './art-image';
import type { ArtContext } from './art-image';

/**
 * The lock image for a state. Solved, settled and challenged all use the `-solved` art
 * (Requirements 8.1, 8.2); `hovered` picks the matching `-hover` image (Requirement 8.3).
 */
export function lockImageFile(lock: LockType, status: SlotStatus, hovered: boolean): string {
  const suffix = status === 'open' ? '' : '-solved';
  return hovered ? `lock-${lock}${suffix}-hover.webp` : `lock-${lock}${suffix}.webp`;
}

/** A candle is lit only while the slot is solved and `candleLit` is true; settled and challenged never light (Requirements 8.6, 9.1). */
export function shouldDrawFlame(status: SlotStatus, candleLit: boolean): boolean {
  return status === 'open' || status === 'solved' ? candleLit : false;
}

export function lightImageFile(lock: LockType): string {
  return `light-${lock}.webp`;
}

export interface LockLayerProps {
  readonly ctx: ArtContext;
  readonly lockType: LockType;
  readonly status: SlotStatus;
  readonly hovered: boolean;
  /** True on the render where a fresh candleLit notice solved this lock: crossfade to the solved image over about 600 ms. */
  readonly animateSolve?: boolean;
}

/**
 * One lock's image. Both the resting and the hover image are in the page, and the hover one
 * fades in over 200 ms (CSS), so nothing depends on hover to be understood (Requirement 8.4).
 */
export function LockLayer({ ctx, lockType, status, hovered, animateSolve = false }: LockLayerProps): ReactNode {
  return (
    <>
      {animateSolve && status !== 'open' ? (
        <ArtImage
          ctx={ctx}
          layer="lock"
          file={lockImageFile(lockType, 'open', false)}
          className="art-layer--solve-out"
          data={{ lock: lockType, status: 'open', transition: 'from' }}
        />
      ) : null}
      <ArtImage
        ctx={ctx}
        layer="lock"
        file={lockImageFile(lockType, status, false)}
        className={`art-layer--rest${animateSolve ? ' art-layer--solve-in' : ''}`}
        data={{ lock: lockType, status, shown: hovered ? 'false' : 'true' }}
      />
      <ArtImage
        ctx={ctx}
        layer="lock"
        file={lockImageFile(lockType, status, true)}
        className="art-layer--hover"
        data={{ lock: lockType, status, shown: hovered ? 'true' : 'false' }}
      />
    </>
  );
}
