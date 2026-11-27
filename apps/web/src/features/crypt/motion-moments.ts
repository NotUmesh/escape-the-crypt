import type { Outcome_Notice, State } from '@escape-the-crypt/core';

/**
 * A moment of motion that goes with one outcome. It holds only IDs and the kind: no learner text.
 * Read-only: nothing here changes State or the Event_Log.
 */
export type MotionMoment =
  | {
      readonly kind: 'candle-lit';
      readonly target: { readonly type: 'slot'; readonly slotId: string } | { readonly type: 'spirit' };
    }
  | { readonly kind: 'ghost-rises'; readonly conceptId: string }
  | { readonly kind: 'ghost-laid-to-rest'; readonly conceptId: string };

/** The `ROOM_ANNOUNCEMENT_COPY.notice` key a moment goes with. */
export type MomentAnnouncementKey = 'candleLit' | 'ghostSpawned' | 'ghostLaidToRest';

export function announcementKeyFor(moment: MotionMoment): MomentAnnouncementKey {
  switch (moment.kind) {
    case 'candle-lit':
      return 'candleLit';
    case 'ghost-rises':
      return 'ghostSpawned';
    case 'ghost-laid-to-rest':
      return 'ghostLaidToRest';
  }
}

/** What the next view shows. Both callers build it from data they already hold. */
interface MomentView {
  readonly litSlotIds: ReadonlySet<string>;
  readonly pendingConceptIds: ReadonlySet<string>;
  /** True when a spirit candle notice is backed by the view. */
  readonly spiritAdded: boolean;
}

function momentFor(notice: Outcome_Notice, view: MomentView): MotionMoment | null {
  switch (notice.kind) {
    case 'candleLit':
      if (notice.target.type === 'slot') {
        return view.litSlotIds.has(notice.target.slotId)
          ? { kind: 'candle-lit', target: { type: 'slot', slotId: notice.target.slotId } }
          : null;
      }
      return view.spiritAdded ? { kind: 'candle-lit', target: { type: 'spirit' } } : null;
    case 'ghostSpawned':
      return view.pendingConceptIds.has(notice.conceptId) ? { kind: 'ghost-rises', conceptId: notice.conceptId } : null;
    case 'ghostLaidToRest':
      return view.pendingConceptIds.has(notice.conceptId)
        ? null
        : { kind: 'ghost-laid-to-rest', conceptId: notice.conceptId };
    default:
      return null;
  }
}

function pick(notices: readonly Outcome_Notice[], view: MomentView): readonly MotionMoment[] {
  const moments: MotionMoment[] = [];
  for (const notice of notices) {
    const moment = momentFor(notice, view);
    if (moment !== null) moments.push(moment);
  }
  return moments;
}

function spiritCount(state: State): number {
  return state.rooms.reduce((n, room) => n + room.spiritCandles.length, 0) + state.finalDoor.spiritCandles.length;
}

/**
 * The moments for one accepted dispatch, in notice order. A restored run (`previous` is null), a
 * rejected dispatch (no notices) and a notice the next State does not back all give nothing.
 */
export function selectMotionMoments(
  previous: State | null,
  next: State,
  notices: readonly Outcome_Notice[],
): readonly MotionMoment[] {
  if (previous === null || notices.length === 0) return [];
  const lit = new Set<string>();
  for (const room of next.rooms) {
    for (const slot of [...room.lockSlots, ...room.dueReturnSlots]) if (slot.candleLit) lit.add(slot.slotId);
  }
  for (const slot of next.finalDoor.slots) if (slot.candleLit) lit.add(slot.slotId);
  return pick(notices, {
    litSlotIds: lit,
    pendingConceptIds: new Set(next.ghosts.map((g) => g.conceptId)),
    spiritAdded: spiritCount(next) > spiritCount(previous),
  });
}

/**
 * The same choice for the Stage, which holds the lit slots and pending ghosts it draws but not the
 * whole State. A spirit candle notice is kept: the Stage draws it from the count it was given.
 */
export function momentsForStage(
  notices: readonly Outcome_Notice[],
  view: { readonly litSlotIds: ReadonlySet<string>; readonly pendingConceptIds: ReadonlySet<string> },
): readonly MotionMoment[] {
  if (notices.length === 0) return [];
  return pick(notices, { ...view, spiritAdded: true });
}
