import type { State } from '@escape-the-crypt/core';
import type { GhostItem } from './ghost-list';

/**
 * The ghosts the learner sees: every pending ghost, plus each due ghost whose returning question is
 * still open (in the current room or at the final door). A due ghost leaves `State.ghosts` when its
 * return falls due; drawing it until the return is answered lets it be laid to rest on screen. Once
 * the return is solved, settled or challenged, or the concept lingers as review due, it is no longer
 * drawn. Read-only.
 */
export function drawnGhosts(state: State): readonly GhostItem[] {
  const out: GhostItem[] = state.ghosts.map((g) => ({ conceptId: g.conceptId, returnNumber: g.returnNumber, due: g.due }));
  const seen = new Set(out.map((g) => g.conceptId));
  const add = (conceptId: string, returnNumber: 1 | 2): void => {
    if (seen.has(conceptId)) return;
    seen.add(conceptId);
    out.push({ conceptId, returnNumber, due: true });
  };
  const room = state.rooms.find((r) => r.roomId === state.currentRoomId);
  if (!state.atFinalDoor) {
    for (const slot of room?.dueReturnSlots ?? []) if (slot.status === 'open') add(slot.conceptId, slot.returnNumber);
  } else {
    for (const slot of state.finalDoor.slots) {
      if (slot.origin === 'return' && slot.status === 'open' && slot.returnNumber !== null) add(slot.conceptId, slot.returnNumber);
    }
  }
  return out;
}
