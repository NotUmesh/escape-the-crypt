/** A ghost placed at a Ghost_Anchor by position (Requirement 18.2). */
export interface AnchoredGhost<T> {
  readonly ghost: T;
  /** `index modulo anchorCount`, or null when the scene has no anchors. */
  readonly anchorIndex: number | null;
}

/** Assigns anchors in ghost order: the anchor at `index modulo anchorCount` (Requirements 18.1, 18.2). */
export function assignGhostAnchors<T>(ghosts: readonly T[], anchorCount: number): readonly AnchoredGhost<T>[] {
  const usable = Number.isInteger(anchorCount) && anchorCount > 0;
  return ghosts.map((ghost, index) => ({ ghost, anchorIndex: usable ? index % anchorCount : null }));
}
