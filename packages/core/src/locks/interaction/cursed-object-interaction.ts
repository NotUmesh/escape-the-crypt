import type { HintEffectSpec } from '../../types';
import type { CursedObjectQuestion, CursedObjectSubmission } from '../cursed-object';
import { displayOrder } from './display-order';
import type { InteractionSubmission } from './interaction-result';

/** The items in display order, the chosen one, and the one a hint removed. */
export interface CursedObjectDraft {
  readonly itemIds: readonly string[];
  readonly chosenId: string | null;
  readonly removedId: string | null;
}

export function initCursedObjectDraft(
  payload: Pick<CursedObjectQuestion, 'optionIds'>,
  hint: HintEffectSpec | null,
  seed: string,
): CursedObjectDraft {
  const removedId =
    hint !== null && hint.kind === 'remove-option' && payload.optionIds.includes(hint.optionId) ? hint.optionId : null;
  return { itemIds: displayOrder(payload.optionIds, seed), chosenId: null, removedId };
}

/**
 * The draft with a hint taken into account. A `remove-option` hint removes its item, and clears the
 * choice if that item was chosen. Idempotent, so a panel can call it on every render and a hint used
 * part way through an answer still counts. Any other hint changes nothing.
 */
export function applyRemoveHint(draft: CursedObjectDraft, hint: HintEffectSpec | null): CursedObjectDraft {
  if (hint === null || hint.kind !== 'remove-option' || !draft.itemIds.includes(hint.optionId)) return draft;
  if (draft.removedId === hint.optionId) return draft;
  return { ...draft, removedId: hint.optionId, chosenId: draft.chosenId === hint.optionId ? null : draft.chosenId };
}

/** Unknown and removed items give back the same draft. */
export function chooseItem(draft: CursedObjectDraft, itemId: string): CursedObjectDraft {
  if (itemId === draft.removedId || !draft.itemIds.includes(itemId)) return draft;
  return { ...draft, chosenId: itemId };
}

export function clearChoice(draft: CursedObjectDraft): CursedObjectDraft {
  return { ...draft, chosenId: null };
}

export function cursedObjectSubmission(draft: CursedObjectDraft): InteractionSubmission<CursedObjectSubmission> {
  if (draft.chosenId === null || draft.chosenId === draft.removedId) return { ready: false, reason: 'nothing-chosen' };
  return { ready: true, submission: { selectedId: draft.chosenId } };
}
