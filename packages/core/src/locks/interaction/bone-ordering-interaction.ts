import type { HintEffectSpec } from '../../types';
import type { BoneOrderingQuestion, BoneOrderingSubmission } from '../bone-ordering';
import { displayOrderAvoiding } from './display-order';
import type { InteractionSubmission } from './interaction-result';

/** What the learner sees: the bones in the order they currently lie, and the one a hint fixed. */
export interface BoneOrderingDraft {
  readonly order: readonly string[];
  readonly pinnedId: string | null;
}
export type BoneDirection = 'up' | 'down';

/**
 * The starting draft. The order is seeded and never the key order (when the list allows it).
 * With a `lock-first-bone` hint the pinned bone starts, and stays, at its key position.
 */
export function initBoneOrderingDraft(
  payload: BoneOrderingQuestion,
  hint: HintEffectSpec | null,
  seed: string,
): BoneOrderingDraft {
  const pinnedId =
    hint !== null && hint.kind === 'lock-first-bone' && payload.keyOrder.includes(hint.boneId) ? hint.boneId : null;
  const pinnedIndex = pinnedId === null ? -1 : payload.keyOrder.indexOf(pinnedId);
  const others = payload.itemIds.filter((id) => id !== pinnedId);
  const place = (rest: readonly string[]): readonly string[] => {
    if (pinnedId === null) return rest;
    const out = [...rest];
    out.splice(Math.min(pinnedIndex, out.length), 0, pinnedId);
    return out;
  };
  const isKey = (candidate: readonly string[]): boolean => {
    const full = place(candidate);
    return full.length === payload.keyOrder.length && full.every((id, i) => id === payload.keyOrder[i]);
  };
  const rest = displayOrderAvoiding(others, seed, isKey);
  return { order: place(rest), pinnedId };
}

/**
 * The draft with a hint taken into account. A `lock-first-bone` hint fixes its bone at its key
 * position; the other bones keep the order the learner gave them. Idempotent, so a panel can call it
 * on every render and a hint used part way through an answer still counts. Any other hint changes nothing.
 */
export function applyBoneHint(
  draft: BoneOrderingDraft,
  payload: BoneOrderingQuestion,
  hint: HintEffectSpec | null,
): BoneOrderingDraft {
  if (hint === null || hint.kind !== 'lock-first-bone') return draft;
  const keyIndex = payload.keyOrder.indexOf(hint.boneId);
  if (keyIndex < 0 || !draft.order.includes(hint.boneId)) return draft;
  if (draft.pinnedId === hint.boneId && draft.order.indexOf(hint.boneId) === keyIndex) return draft;
  const rest = draft.order.filter((id) => id !== hint.boneId);
  const order = [...rest];
  order.splice(Math.min(keyIndex, order.length), 0, hint.boneId);
  return { order, pinnedId: hint.boneId };
}

/**
 * Moves one bone a step. It swaps with the nearest bone in that direction, jumping over the
 * pinned bone so the pinned bone never leaves its place. Out of range, unknown and pinned
 * bones give back the same draft.
 */
export function moveBone(draft: BoneOrderingDraft, boneId: string, direction: BoneDirection): BoneOrderingDraft {
  const from = draft.order.indexOf(boneId);
  if (from < 0 || boneId === draft.pinnedId) return draft;
  const step = direction === 'up' ? -1 : 1;
  let to = from + step;
  if (draft.pinnedId !== null && draft.order[to] === draft.pinnedId) to += step;
  const target = draft.order[to];
  if (to < 0 || to >= draft.order.length || target === undefined) return draft;
  const next = [...draft.order];
  next[from] = target;
  next[to] = boneId;
  return { ...draft, order: next };
}

export function boneOrderingSubmission(draft: BoneOrderingDraft): InteractionSubmission<BoneOrderingSubmission> {
  return { ready: true, submission: { order: [...draft.order] } };
}
