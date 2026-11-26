import type { ReactNode } from 'react';
import { ROOM_PLAY_LABELS } from '@escape-the-crypt/core';
import { ghostName } from './accessible-names';
import { assignGhostAnchors } from './ghost-assignment';

/** The fields of a pending ghost this list reads (a subset of State.ghosts entries). */
export interface GhostItem {
  readonly conceptId: string;
  readonly returnNumber: 1 | 2;
  readonly due: boolean;
}

export interface GhostListProps {
  readonly ghosts: readonly GhostItem[];
  /** Number of Ghost_Anchors in the current Scene_File, when known. */
  readonly anchorCount?: number;
  /** Lit Spirit_Candles for the current room or the final door. */
  readonly spiritCandleCount?: number;
}

/** Pending ghosts and lit Spirit_Candles as plain text. Never intercepts pointer events (Requirement 18.10). */
export function GhostList({ ghosts, anchorCount = 0, spiritCandleCount = 0 }: GhostListProps): ReactNode {
  if (ghosts.length === 0 && spiritCandleCount === 0) return null;
  const placed = assignGhostAnchors(ghosts, anchorCount);
  return (
    <div className="ghost-list" data-testid="ghost-list">
      {placed.length > 0 ? (
        <ul className="ghost-list__ghosts">
          {placed.map(({ ghost, anchorIndex }) => (
            <li
              key={`${ghost.conceptId}:${ghost.returnNumber}`}
              className="ghost-list__ghost"
              data-anchor={anchorIndex ?? undefined}
            >
              <span>{ghostName(ghost.returnNumber)}</span>
              {ghost.due ? null : <span className="ghost-list__later"> {ROOM_PLAY_LABELS.ghostReturnsLater}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {spiritCandleCount > 0 ? (
        <p className="ghost-list__spirit">
          <span className="ghost-list__flame" aria-hidden="true">
            {'\u2726'}
          </span>{' '}
          {spiritCandleCount === 1 ? 'Spirit candle lit' : `Spirit candles lit: ${spiritCandleCount}`}
        </p>
      ) : null}
    </div>
  );
}
