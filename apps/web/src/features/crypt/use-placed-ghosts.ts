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
/**
 * How long a ghost that left without a `ghostLaidToRest` notice stays drawn. A saved run releases
 * notices a render after the State (once the Event is written), so the notice can arrive just after
 * the ghost has left the list. Within this time the late notice still starts the fade.
 */
export const LATE_NOTICE_GRACE_MS = 400;

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
  const [parked, setParked] = useState<readonly AnchoredGhost<GhostItem>[]>([]);
  if (seen.signature !== signature) {
    const current = new Set(placed.map((p) => keyOf(p.ghost)));
    const gone = seen.placed.filter((p) => !current.has(keyOf(p.ghost)));
    const departing = gone.filter((p) => laidToRest.has(p.ghost.conceptId));
    setSeen({ signature, placed });
    if (departing.length > 0) setLeaving((prev) => [...prev, ...departing]);
    setParked(gone.filter((p) => !laidToRest.has(p.ghost.conceptId)));
  } else {
    const late = parked.filter((p) => laidToRest.has(p.ghost.conceptId));
    if (late.length > 0) {
      setParked((prev) => prev.filter((p) => !laidToRest.has(p.ghost.conceptId)));
      setLeaving((prev) => [...prev, ...late]);
    }
  }
  useEffect(() => {
    if (leaving.length === 0) return undefined;
    const timer = setTimeout(() => setLeaving([]), GHOST_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  useEffect(() => {
    if (parked.length === 0) return undefined;
    const timer = setTimeout(() => setParked([]), LATE_NOTICE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [parked]);
  return [
    ...placed.map((p) => ({ ...p, leaving: false })),
    ...parked.map((p) => ({ ...p, leaving: false })),
    ...leaving.map((p) => ({ ...p, leaving: true })),
  ];
}
