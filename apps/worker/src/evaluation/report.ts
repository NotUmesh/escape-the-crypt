import type { NoteRun } from './result-file';

/** Counts for one lock type over a set of runs. Rates are left to the reader; these are counts. */
export interface LockTypeSummary {
  candidates: number;
  accepted: number;
  codeCheckRejected: number;
  reviewRejected: number;
  /** Questions that passed Code_Checks but were never reviewed (a stop before review). */
  notReviewed: number;
  /** Blocking Check_ID -> questions failing it (a question counts once per Check_ID). */
  byCheckId: Record<string, number>;
  /** Review rejection kind -> questions. */
  byReviewReason: Record<string, number>;
  /** Placement of accepted questions -> count. */
  byPlacement: Record<string, number>;
  /** Why the mapper refused accepted questions -> count. */
  byMapperReason: Record<string, number>;
  /** By role: candidates and accepted. */
  byRole: Record<'primary' | 'alternate', { candidates: number; accepted: number }>;
}

export interface DevSetSummary {
  notes: number;
  notesPublished: number;
  /** Concept generation outcome -> concepts. */
  conceptGeneration: Record<string, number>;
  byLockType: Record<string, LockTypeSummary>;
  /** Locks in the published room -> notes. Failed notes count under 0. */
  locksPerRoom: Record<string, number>;
  /** Station type -> rooms that have it. */
  roomsWithStation: Record<string, number>;
  duplicateAnswers: number;
  liveCalls: number;
  replayedCalls: number;
  costUsd: number;
}

const bump = (r: Record<string, number>, k: string, by = 1): void => {
  r[k] = (r[k] ?? 0) + by;
};

const emptyType = (): LockTypeSummary => ({
  candidates: 0,
  accepted: 0,
  codeCheckRejected: 0,
  reviewRejected: 0,
  notReviewed: 0,
  byCheckId: {},
  byReviewReason: {},
  byPlacement: {},
  byMapperReason: {},
  byRole: { primary: { candidates: 0, accepted: 0 }, alternate: { candidates: 0, accepted: 0 } },
});

/** Pure: one summary over the given note runs. */
export function summarise(notes: readonly NoteRun[]): DevSetSummary {
  const s: DevSetSummary = {
    notes: notes.length,
    notesPublished: 0,
    conceptGeneration: {},
    byLockType: {},
    locksPerRoom: {},
    roomsWithStation: {},
    duplicateAnswers: 0,
    liveCalls: 0,
    replayedCalls: 0,
    costUsd: 0,
  };
  for (const note of notes) {
    if (note.ok) s.notesPublished += 1;
    s.liveCalls += note.liveCalls;
    s.replayedCalls += note.replayedCalls;
    s.costUsd += note.costUsd;
    for (const c of note.concepts) bump(s.conceptGeneration, c.generation);
    for (const c of note.candidates) {
      const t = (s.byLockType[c.lockType] ??= emptyType());
      t.candidates += 1;
      t.byRole[c.role].candidates += 1;
      if (c.result === 'accepted') {
        t.accepted += 1;
        t.byRole[c.role].accepted += 1;
        bump(t.byPlacement, c.placement ?? 'not-placed');
        if (c.mapperReason !== null) bump(t.byMapperReason, c.mapperReason);
      } else if (c.result === 'code-check-rejected') {
        t.codeCheckRejected += 1;
        for (const id of c.checkIds) bump(t.byCheckId, id);
      } else if (c.result === 'review-rejected') {
        t.reviewRejected += 1;
        bump(t.byReviewReason, c.reviewReason ?? 'unknown');
      } else {
        t.notReviewed += 1;
      }
    }
    const slots = note.room?.slots ?? [];
    bump(s.locksPerRoom, String(slots.length));
    for (const station of new Set(slots.map((x) => x.stationType))) bump(s.roomsWithStation, station);
    s.duplicateAnswers += note.room?.duplicateAnswers ?? 0;
  }
  s.costUsd = Math.round(s.costUsd * 1e6) / 1e6;
  return s;
}
