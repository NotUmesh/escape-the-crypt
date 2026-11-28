import type { ReactNode } from 'react';
import { ghostName } from './accessible-names';
import type { ArtEffects } from './art-effects';
import { Flame } from './flame';
import type { GhostItem } from './ghost-list';
import type { ViewportPoint } from './hotspot-geometry';
import { usePlacedGhosts } from './use-placed-ghosts';
import './ghost-layer.css';

export interface GhostLayerProps {
  /** Ghost_Anchors in stage px, through the one Crop_Mapping. */
  readonly anchors: readonly ViewportPoint[];
  readonly frameWidth: number;
  readonly ghosts: readonly GhostItem[];
  /** Lit Spirit_Candles for the current room or the final door. */
  readonly spiritCandleCount: number;
  readonly effects: ArtEffects;
}

export function GhostFigure(): ReactNode {
  return (
    <svg className="ghost-art__body" viewBox="0 0 40 52" focusable="false">
      <path
        className="ghost-art__shape"
        d="M20 2 C 9 2 4 11 4 22 L 4 50 L 10 44 L 15 50 L 20 44 L 25 50 L 30 44 L 36 50 L 36 22 C 36 11 31 2 20 2 Z"
      />
      <circle className="ghost-art__eye" cx="14" cy="22" r="2.5" />
      <circle className="ghost-art__eye" cx="26" cy="22" r="2.5" />
    </svg>
  );
}

/**
 * Ghosts and Spirit_Candle flames at the Ghost_Anchors. Drawn for sight only: the text list carries the
 * names, nothing here takes pointer events, and the layer sits under the controls (Requirement 18.10).
 */
export function GhostLayer({ anchors, frameWidth, ghosts, spiritCandleCount, effects }: GhostLayerProps): ReactNode {
  const placed = usePlacedGhosts(ghosts, anchors.length, effects.laidToRestConcepts);
  const ghostWidth = Math.max(frameWidth * 0.04, 28);
  return (
    <div className="ghost-layer" data-testid="ghost-layer" aria-hidden="true">
      {placed.map(({ ghost, anchorIndex, leaving }) => {
        const anchor = anchorIndex === null ? undefined : anchors[anchorIndex];
        if (anchor === undefined) return null;
        const rising = !leaving && effects.spawnedConcepts.has(ghost.conceptId);
        return (
          <span
            key={`${ghost.conceptId}:${ghost.returnNumber}`}
            className={`ghost-art${rising ? ' ghost-art--rise' : ''}${leaving ? ' ghost-art--leaving' : ''}`}
            data-ghost={ghost.conceptId}
            data-return={ghost.returnNumber}
            data-anchor={anchorIndex ?? undefined}
            data-state={leaving ? 'leaving' : rising ? 'rising' : 'present'}
            title={ghostName(ghost.returnNumber)}
            style={{ left: anchor.x, top: anchor.y, width: ghostWidth, height: ghostWidth * 1.3 }}
          >
            <GhostFigure />
          </span>
        );
      })}
      {anchors.length === 0
        ? null
        : Array.from({ length: spiritCandleCount }, (_, index) => {
            // Spirit candles take anchors from the last one backwards, away from the ghosts.
            const anchor = anchors[anchors.length - 1 - (index % anchors.length)];
            if (anchor === undefined) return null;
            return (
              <Flame
                key={`spirit-${index}`}
                kind="spirit"
                x={anchor.x}
                y={anchor.y}
                scale={1}
                frameWidth={frameWidth}
                ignite={index >= spiritCandleCount - effects.spiritLit}
                data={{ spirit: String(index) }}
              />
            );
          })}
    </div>
  );
}
