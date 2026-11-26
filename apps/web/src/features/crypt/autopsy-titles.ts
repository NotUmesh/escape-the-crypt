import type { AutopsyEntry, CryptContent } from '@escape-the-crypt/core';

/** An autopsy entry with the concept title from the crypt content (Req 20.3, 22.1). */
export interface AutopsyEntryView extends AutopsyEntry {
  readonly title: string;
}

/**
 * Attach concept titles to autopsy entries, keeping entry order.
 * A missing title falls back to the concept ID. Titles stay plain strings.
 */
export function withConceptTitles(
  entries: readonly AutopsyEntry[],
  content: CryptContent,
): readonly AutopsyEntryView[] {
  return entries.map((entry) => {
    const concept = Object.hasOwn(content.concepts, entry.conceptId)
      ? content.concepts[entry.conceptId]
      : undefined;
    const title = concept?.title;
    return { ...entry, title: typeof title === 'string' && title !== '' ? title : entry.conceptId };
  });
}
