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
