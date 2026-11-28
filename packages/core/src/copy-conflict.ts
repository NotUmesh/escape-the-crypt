/**
 * Messages for a crypt that is shorter than requested, or that leaves a topic out
 * because two passages seem to disagree. These are messages, not evidence labels
 * (decision D9): no new label is added to the Requirement 26.3 set.
 */

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Says a topic was left out and why. The learner decides which passage they meant. */
export function conflictLeftOut(title: string): string {
  return `We left out \u201C${title}\u201D because two passages in your notes seem to say different things.`;
}

/** Heading for one of the two passages shown side by side. */
export function conflictPassage(n: number): string {
  return `Passage ${n}`;
}

/** What the learner can do next. */
export const conflictNext =
  'Check which one you meant in your notes. If you fix them, build the crypt again to include this topic.';

/** The notes held fewer askable topics than the chosen length needs. */
export function cryptSufficiency(found: number, needed: number, built: number, requested: number): string {
  return `Your notes gave us ${found} ${plural(found, 'topic', 'topics')} we could ask about. A ${requested}-room crypt needs ${needed}, so this crypt has ${built} ${plural(built, 'room', 'rooms')} instead.`;
}

/** Some questions were set aside, so the crypt is shorter than requested. */
export function cryptSetAside(built: number, requested: number): string {
  return `Some questions were set aside, so this crypt has ${built} ${plural(built, 'room', 'rooms')} instead of ${requested}.`;
}
