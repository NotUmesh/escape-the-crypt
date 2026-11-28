import type { BoneOrderingAuthoringQuestion } from '../authoring/schema';
import { checkQuote, resolvesUniquely, type QuoteContext } from '../checks/evidence';
import type { CheckFailure } from '../checks/types';
import { normaliseWithMap } from '../normalise';

export const MIN_STEPS = 3;
export const MAX_STEPS = 5;

/**
 * Wording that states an explicit order: ordinals, first/next/then/finally wording,
 * "step N", "starting at/with/from", or list numbering ("1." / "2)").
 * A heuristic: it reads the wording of resolved quotes only, never the learner's intent.
 */
const SEQUENCE_MARKER =
  /\b(?:first(?:ly)?|secondly|second,|thirdly|third,|next|then|finally|lastly|afterwards?|after that|subsequently|step\s*\d+|starting (?:at|with|from)|begins? with)\b|(?:^|\s)\(?\d{1,2}[.)]\s/i;

type StepsInput = Pick<BoneOrderingAuthoringQuestion, 'id' | 'steps'>;
type PromptStepsInput = Pick<BoneOrderingAuthoringQuestion, 'id' | 'steps' | 'prompt'>;
type EvidenceInput = Pick<BoneOrderingAuthoringQuestion, 'id' | 'evidence'>;

function duplicateKey(text: string): string {
  return normaliseWithMap(text).text.toLowerCase();
}

/** `step-count`: 3 to 5 steps. */
export function checkStepCount(question: StepsInput): readonly CheckFailure[] {
  const n = question.steps.length;
  return n < MIN_STEPS || n > MAX_STEPS ? [{ checkId: 'step-count', questionId: question.id }] : [];
}

/** `duplicate-steps`: two steps equal after whitespace and case normalisation. */
export function checkDuplicateSteps(question: StepsInput): readonly CheckFailure[] {
  const keys = question.steps.map(duplicateKey);
  return new Set(keys).size !== keys.length
    ? [{ checkId: 'duplicate-steps', questionId: question.id }]
    : [];
}

/**
 * `steps-listed-in-prompt`: the prompt must not give the order away. Fires when two or
 * more step texts appear in the prompt and every step found appears in key order.
 * `steps` is the key order, so a prompt that names steps in that order hands over
 * (part of) the answer.
 */
export function checkStepsListedInPrompt(question: PromptStepsInput): readonly CheckFailure[] {
  const prompt = duplicateKey(question.prompt);
  const positions = question.steps
    .map((step) => {
      const key = duplicateKey(step);
      return key.length > 0 ? prompt.indexOf(key) : -1;
    })
    .filter((at) => at >= 0);
  if (positions.length < 2) return [];
  const inOrder = positions.every((at, i) => i === 0 || at > positions[i - 1]!);
  return inOrder ? [{ checkId: 'steps-listed-in-prompt', questionId: question.id }] : [];
}

/**
 * `no-explicit-sequence-marker-in-quotes`: none of the resolved quotes states an order.
 * Quotes that do not resolve are skipped (they already fail a quote check); with no
 * resolved quote there is nothing to read, so this check does not fire.
 */
export function checkSequenceMarker(
  question: EvidenceInput,
  context: QuoteContext,
): readonly CheckFailure[] {
  const resolved = question.evidence.filter((e) => resolvesUniquely(context, e));
  if (resolved.length === 0) return [];
  return resolved.some((e) => SEQUENCE_MARKER.test(e.quote))
    ? []
    : [{ checkId: 'no-explicit-sequence-marker-in-quotes', questionId: question.id }];
}

/** All bone-ordering Code_Checks plus each evidence quote's own checks. Pure; never throws. */
export function boneOrderingChecks(
  question: BoneOrderingAuthoringQuestion,
  context: QuoteContext,
): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const e of question.evidence) {
    const failure = checkQuote(
      context.chunks,
      { paragraphChunkId: context.paragraphChunkIds.get(e.paragraph) ?? '', quote: e.quote },
      question.id,
    );
    if (failure) failures.push(failure);
  }
  failures.push(
    ...checkStepCount(question),
    ...checkDuplicateSteps(question),
    ...checkStepsListedInPrompt(question),
    ...checkSequenceMarker(question, context),
  );
  return failures;
}
