import { useEffect, useState } from 'react';
import { assignGhostAnchors } from './ghost-assignment';
import type { AnchoredGhost } from './ghost-assignment';
import type { GhostItem } from './ghost-list';

export interface PlacedGhost extends AnchoredGhost<GhostItem> {
  /** True while a laid-to-rest ghost fades out. */
  readonly leaving: boolean;
}

/** Time a laid-to-rest ghost stays in the page to fade out. */
export const GHOST_FADE_MS = 700;

function keyOf(ghost: GhostItem): string {
  return `${ghost.conceptId}:${ghost.returnNumber}`;
}

/**
 * Ghosts placed at anchors in `selectGhosts` order (Requirements 18.1, 18.2). A ghost named by a
 * `ghostLaidToRest` notice stays, at the anchor it had, for one fade before it is removed (Requirement 18.5).
 */
export function usePlacedGhosts(
  ghosts: readonly GhostItem[],
  anchorCount: number,
  laidToRest: ReadonlySet<string>,
): readonly PlacedGhost[] {
  const placed = assignGhostAnchors(ghosts, anchorCount);
  const signature = placed.map((p) => `${keyOf(p.ghost)}@${p.anchorIndex ?? '-'}`).join('|');
  const [seen, setSeen] = useState({ signature, placed });
  const [leaving, setLeaving] = useState<readonly AnchoredGhost<GhostItem>[]>([]);
  if (seen.signature !== signature) {
    const current = new Set(placed.map((p) => keyOf(p.ghost)));
    const departing = seen.placed.filter((p) => laidToRest.has(p.ghost.conceptId) && !current.has(keyOf(p.ghost)));
    setSeen({ signature, placed });
    if (departing.length > 0) setLeaving((prev) => [...prev, ...departing]);
  }
  useEffect(() => {
    if (leaving.length === 0) return undefined;
    const timer = setTimeout(() => setLeaving([]), GHOST_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  return [
    ...placed.map((p) => ({ ...p, leaving: false })),
    ...leaving.map((p) => ({ ...p, leaving: true })),
  ];
}
