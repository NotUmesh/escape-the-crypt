import { citationLabel, resolveQuote } from '@escape-the-crypt/core';
import type { CryptContent, FinalDoorSlotState, LockSlotState, ReturnSlotState } from '@escape-the-crypt/core';

import type { RoomAssets } from '../../state/room-assets';

export type EvidenceResult = 'correct' | 'wrong' | null;

/**
 * Which evidence wording a slot's panel shows. A Lock_Slot follows its judged result;
 * Return_Slots and Final_Door slots carry none, so their status decides.
 * Challenged and open slots show neither wording.
 */
export function evidenceResult(slot: LockSlotState | ReturnSlotState | FinalDoorSlotState): EvidenceResult {
  if ('judgedResult' in slot) {
    return slot.judgedResult === 'correct' || slot.judgedResult === 'wrong' ? slot.judgedResult : null;
  }
  if (slot.status === 'solved') return 'correct';
  if (slot.status === 'settled') return 'wrong';
  return null;
}

/** One excerpt of a Crypt_Content entry. Its `optionId` marks an Option_Excerpt. */
export type Excerpt = CryptContent['questions'][string]['excerpts'][number];

export interface ResolvedExcerpt {
  readonly quote: string;
  readonly citationLabel: string;
  readonly matched: boolean;
}

/**
 * Resolves one excerpt against the run's chunks. `matched` is true only when the quote resolves
 * to exactly one place in a known chunk. An unknown chunk gives an empty label and `matched: false`.
 */
export function resolveExcerpt(
  assets: Pick<RoomAssets, 'chunks'>,
  excerpt: Excerpt,
  source: 'notes' | 'sample',
): ResolvedExcerpt {
  const chunk = assets.chunks.get(excerpt.chunkId);
  const matched = chunk !== undefined && resolveQuote(assets.chunks, excerpt.chunkId, excerpt.quote).ok;
  return {
    quote: excerpt.quote,
    citationLabel: chunk === undefined ? '' : citationLabel(chunk, source),
    matched,
  };
}

/**
 * Orders excerpts by index so each appears once: the chosen Option_Excerpt, then the key
 * Option_Excerpt, then the rest in stored order. A missing or repeated option id adds nothing extra.
 */
export function orderExcerpts(
  excerpts: readonly Excerpt[],
  chosenOptionId?: string,
  keyOptionId?: string,
): Excerpt[] {
  const used = new Set<number>();
  const result: Excerpt[] = [];
  const take = (index: number): void => {
    const excerpt = excerpts[index];
    if (excerpt === undefined || used.has(index)) return;
    used.add(index);
    result.push(excerpt);
  };
  for (const optionId of [chosenOptionId, keyOptionId]) {
    if (optionId === undefined) continue;
    take(excerpts.findIndex((e) => e.optionId === optionId));
  }
  excerpts.forEach((_e, index) => take(index));
  return result;
}