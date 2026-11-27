import type { HintEffectSpec, JudgeResult, ThreadPair } from '../types';

export interface BoundThreadsQuestion {
  readonly leftIds: readonly string[];
  readonly rightIds: readonly string[];
  readonly keyPairs: readonly ThreadPair[];
}

export interface BoundThreadsSubmission {
  readonly pairs: readonly ThreadPair[];
}

export interface MappedBoundThreads {
  readonly payload: BoundThreadsQuestion;
  readonly hintEffect: Extract<HintEffectSpec, { kind: 'tie-thread' }>;
}

/**
 * Additive mapper helper. One generated item ID per side and pair
 * (`<questionId>-left-<i>`, `<questionId>-right-<i>`); `keyPairs` follow authoring order.
 * An authored hint names pair texts: it is accepted when its two texts, in either order, match
 * the left and right text of one authored pair, and it then pins that pair. An absent hint
 * pins the first pair. A disagreeing hint, or no pairs, returns `null`. Pure, never throws.
 */
export function mapBoundThreadsPayload(
  questionId: string,
  pairs: readonly { readonly left: string; readonly right: string }[],
  authoredHint?: readonly [string, string],
): MappedBoundThreads | null {
  const leftIds = pairs.map((_, i) => `${questionId}-left-${i}`);
  const rightIds = pairs.map((_, i) => `${questionId}-right-${i}`);
  const keyPairs = pairs.map((_, i): ThreadPair => [leftIds[i] ?? '', rightIds[i] ?? '']);
  let index = 0;
  if (authoredHint !== undefined) {
    const [a, b] = authoredHint;
    index = pairs.findIndex(
      (p) => (p.left === a && p.right === b) || (p.left === b && p.right === a),
    );
  }
  const pinned = keyPairs[index];
  if (index < 0 || pinned === undefined) return null;
  return {
    payload: { leftIds, rightIds, keyPairs },
    hintEffect: { kind: 'tie-thread', pair: pinned },
  };
}

const SEPARATOR = '\u0000';

function pairKey(pair: ThreadPair): string {
  return `${pair[0]}${SEPARATOR}${pair[1]}`;
}

function isPair(value: unknown): value is ThreadPair {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}

/** Sorted, de-duplicated pair keys. Order of the input never matters. */
function normalise(pairs: readonly ThreadPair[]): readonly string[] {
  return [...new Set(pairs.map(pairKey))].sort();
}

/**
 * Pure, never throws.
 * - Malformed input, unknown ids, an untied left item, or a left or right item
 *   tied more than once (not one-to-one) is invalid.
 * - A missing pair tied by an applied tie-thread hint is invalid.
 * - Otherwise the pair set equals the key set: correct; else wrong.
 */
export function judge(
  question: BoundThreadsQuestion,
  submission: BoundThreadsSubmission,
  appliedHint: HintEffectSpec | null,
): JudgeResult {
  const sub: unknown = submission;
  const submitted: unknown =
    typeof sub === 'object' && sub !== null && 'pairs' in sub ? sub.pairs : undefined;
  if (!Array.isArray(submitted) || !submitted.every(isPair)) return 'invalid';
  const pairs: readonly ThreadPair[] = submitted;

  const lefts = new Set(question.leftIds);
  const rights = new Set(question.rightIds);
  const unique = [...new Map(pairs.map((p) => [pairKey(p), p] as const)).values()];

  const leftsTied = new Set<string>();
  const rightsTied = new Set<string>();
  for (const [left, right] of unique) {
    if (!lefts.has(left) || !rights.has(right)) return 'invalid';
    if (leftsTied.has(left) || rightsTied.has(right)) return 'invalid';
    leftsTied.add(left);
    rightsTied.add(right);
  }
  for (const left of lefts) {
    if (!leftsTied.has(left)) return 'invalid';
  }

  const submittedKeys = normalise(unique);
  if (appliedHint?.kind === 'tie-thread') {
    if (!submittedKeys.includes(pairKey(appliedHint.pair))) return 'invalid';
  }

  const keyKeys = normalise(question.keyPairs);
  const equal =
    submittedKeys.length === keyKeys.length && submittedKeys.every((k, i) => k === keyKeys[i]);
  return equal ? 'correct' : 'wrong';
}
