/** What happened, never how it looks or sounds (Req 24.6). */
export type Outcome_Notice =
  | {
      readonly kind: 'candleLit';
      readonly target:
        | { readonly type: 'slot'; readonly slotId: string }
        | { readonly type: 'spirit'; readonly roomId: string };
    }
  | { readonly kind: 'ghostSpawned'; readonly conceptId: string }
  | { readonly kind: 'ghostLaidToRest'; readonly conceptId: string }
  | { readonly kind: 'sealCracked'; readonly slotId: string }
  | { readonly kind: 'roomCleared'; readonly roomId: string }
  | { readonly kind: 'escaped' };

export type NoticeKind = Outcome_Notice['kind'];

/** The one ordering list for notices caused by a single event (Req 24.8). */
export const NOTICE_ORDER: readonly NoticeKind[] = [
  'candleLit',
  'ghostLaidToRest',
  'ghostSpawned',
  'sealCracked',
  'roomCleared',
  'escaped',
];

/** Room ID used in a spirit `candleLit` target for the Final_Door (Req 24.3). */
export const FINAL_DOOR_TARGET = 'final-door';

export function candleLitForSlot(slotId: string): Outcome_Notice {
  return { kind: 'candleLit', target: { type: 'slot', slotId } };
}

/** `roomId` is a room ID, or `FINAL_DOOR_TARGET` for the Final_Door. */
export function candleLitForSpirit(roomId: string): Outcome_Notice {
  return { kind: 'candleLit', target: { type: 'spirit', roomId } };
}

export function ghostSpawned(conceptId: string): Outcome_Notice {
  return { kind: 'ghostSpawned', conceptId };
}

export function ghostLaidToRest(conceptId: string): Outcome_Notice {
  return { kind: 'ghostLaidToRest', conceptId };
}

export function sealCracked(slotId: string): Outcome_Notice {
  return { kind: 'sealCracked', slotId };
}

export function roomCleared(roomId: string): Outcome_Notice {
  return { kind: 'roomCleared', roomId };
}

export function escaped(): Outcome_Notice {
  return { kind: 'escaped' };
}

/**
 * Put one event's notices into the fixed order. The sort is stable, so notices of
 * the same kind keep the order they were built in. A repeated `roomCleared` for the
 * same room and a repeated `escaped` are dropped (Req 24.7).
 */
export function orderNotices(notices: readonly Outcome_Notice[]): readonly Outcome_Notice[] {
  const seenRooms = new Set<string>();
  let seenEscaped = false;
  const kept: Outcome_Notice[] = [];
  for (const notice of notices) {
    if (notice.kind === 'roomCleared') {
      if (seenRooms.has(notice.roomId)) continue;
      seenRooms.add(notice.roomId);
    } else if (notice.kind === 'escaped') {
      if (seenEscaped) continue;
      seenEscaped = true;
    }
    kept.push(notice);
  }
  const rank = (n: Outcome_Notice): number => NOTICE_ORDER.indexOf(n.kind);
  return kept
    .map((notice, index) => ({ notice, index }))
    .sort((a, b) => rank(a.notice) - rank(b.notice) || a.index - b.index)
    .map((entry) => entry.notice);
}
