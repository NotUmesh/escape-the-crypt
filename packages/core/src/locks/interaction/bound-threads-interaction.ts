import type { HintEffectSpec, ThreadPair } from '../../types';
import type { BoundThreadsQuestion, BoundThreadsSubmission } from '../bound-threads';
import { displayOrderAvoiding } from './display-order';
import type { InteractionSubmission } from './interaction-result';

/** Left items in authoring order, right items shuffled, the pairs tied so far and the left item picked. */
export interface BoundThreadsDraft {
  readonly leftIds: readonly string[];
  readonly rightOrder: readonly string[];
  readonly selectedLeft: string | null;
  readonly pairs: readonly ThreadPair[];
  readonly hintedPair: ThreadPair | null;
}
export type ThreadRefusal = 'no-left-selected' | 'already-tied' | 'unknown-item';
export type TieResult =
  | { readonly ok: true; readonly draft: BoundThreadsDraft }
  | { readonly ok: false; readonly refusal: ThreadRefusal };

/**
 * The starting draft. No right item starts on the row of its key partner (when the list allows
 * it). A `tie-thread` hint pre-ties its pair, and that pair cannot be undone.
 */
export function initBoundThreadsDraft(
  payload: BoundThreadsQuestion,
  hint: HintEffectSpec | null,
  seed: string,
): BoundThreadsDraft {
  const partnerOf = new Map(payload.keyPairs.map(([l, r]) => [l, r] as const));
  const rightOrder = displayOrderAvoiding(payload.rightIds, seed, (candidate) =>
    payload.leftIds.some((left, i) => partnerOf.get(left) === candidate[i]),
  );
  const hinted =
    hint !== null &&
    hint.kind === 'tie-thread' &&
    payload.leftIds.includes(hint.pair[0]) &&
    payload.rightIds.includes(hint.pair[1])
      ? ([hint.pair[0], hint.pair[1]] as const)
      : null;
  return {
    leftIds: payload.leftIds,
    rightOrder,
    selectedLeft: null,
    pairs: hinted === null ? [] : [hinted],
    hintedPair: hinted,
  };
}

export function isLeftTied(draft: BoundThreadsDraft, leftId: string): boolean {
  return draft.pairs.some(([l]) => l === leftId);
}
export function isRightTied(draft: BoundThreadsDraft, rightId: string): boolean {
  return draft.pairs.some(([, r]) => r === rightId);
}

/** Picks a left item, or clears the pick when it is already picked. Tied and unknown items change nothing. */
export function selectLeft(draft: BoundThreadsDraft, leftId: string): BoundThreadsDraft {
  if (!draft.leftIds.includes(leftId) || isLeftTied(draft, leftId)) return draft;
  return { ...draft, selectedLeft: draft.selectedLeft === leftId ? null : leftId };
}

/** Ties the picked left item to a right item, keeping every item in at most one thread. */
export function tieRight(draft: BoundThreadsDraft, rightId: string): TieResult {
  if (!draft.rightOrder.includes(rightId)) return { ok: false, refusal: 'unknown-item' };
  if (draft.selectedLeft === null) return { ok: false, refusal: 'no-left-selected' };
  if (isRightTied(draft, rightId) || isLeftTied(draft, draft.selectedLeft)) return { ok: false, refusal: 'already-tied' };
  return {
    ok: true,
    draft: { ...draft, pairs: [...draft.pairs, [draft.selectedLeft, rightId]], selectedLeft: null },
  };
}

/** Removes the thread on a left item. The hinted thread and unknown items change nothing. */
export function undoThread(draft: BoundThreadsDraft, leftId: string): BoundThreadsDraft {
  if (draft.hintedPair !== null && draft.hintedPair[0] === leftId) return draft;
  if (!isLeftTied(draft, leftId)) return draft;
  return { ...draft, pairs: draft.pairs.filter(([l]) => l !== leftId) };
}

export function boundThreadsSubmission(draft: BoundThreadsDraft): InteractionSubmission<BoundThreadsSubmission> {
  if (!draft.leftIds.every((id) => isLeftTied(draft, id))) return { ready: false, reason: 'untied-left' };
  return { ready: true, submission: { pairs: draft.pairs.map(([l, r]) => [l, r] as const) } };
}
