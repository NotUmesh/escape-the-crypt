import { CHECK_REGISTRY } from './core-imports';
import type { CheckId } from './core-imports';

export interface CheckHint {
  /** What the check found, in plain words. */
  readonly problem: string;
  /** What to change. A question that cannot be fixed is set aside, never waved through. */
  readonly fix: string;
}

/**
 * Plain-language help for each Check_ID the Power can report. The checks themselves live in core and
 * return only an ID; this text is the Power's. A test asserts every implemented check has an entry,
 * so a check added to core without help text fails the Power's tests.
 */
const HINTS: Readonly<Partial<Record<CheckId, CheckHint>>> = {
  'quote-not-found': {
    problem: 'The quote does not appear in the cited paragraph, even after the notes and the quote are normalised.',
    fix: 'Copy the quote exactly from the paragraph text returned by prepare_notes, or cite the paragraph it really sits in.',
  },
  'quote-ambiguous': {
    problem: 'The quote appears more than once in the cited paragraph, so it does not point to one place.',
    fix: 'Quote a longer or more specific run of words that appears once.',
  },
  'quote-too-short': {
    problem: 'The quote has fewer than 4 words or fewer than 20 characters.',
    fix: 'Quote a fuller phrase from the sentence that states the fact.',
  },
  'quote-too-long': {
    problem: 'The quote is longer than 25 words.',
    fix: 'Quote only the part of the sentence that carries the fact.',
  },
  'unknown-paragraph/chunk': {
    problem: 'The cited paragraph number is not a quotable paragraph of these notes (headings are not quotable).',
    fix: 'Use a paragraph number from the prepare_notes result.',
  },
  'banned-phrase': {
    problem: 'Visible text uses wording the project does not allow, for example a claim of accuracy or a vague "source document".',
    fix: 'Reword the prompt, options or explanation. Say "your notes".',
  },
  'negative-question': {
    problem: 'The prompt asks a negative question ("not", "never", "except", "incorrect", "false").',
    fix: 'Ask for what the notes state, not for what they do not. An odd-one-out prompt of the form "Which one is not ..." is the one exception.',
  },
  'rune-needs-one-blank': {
    problem: 'A fill-in-the-blank prompt must contain exactly one blank.',
    fix: 'Use one run of underscores where the answer goes.',
  },
  'answer-not-in-quote': {
    problem: 'The answer (or an alias) does not appear in any evidence quote.',
    fix: 'Choose an answer the quote states word for word, or quote the sentence that contains it.',
  },
  'answer-leak-in-prompt': {
    problem: 'The answer appears in the prompt itself.',
    fix: 'Rephrase the prompt so it does not contain the answer.',
  },
  'answer-leak-in-room': {
    problem: "The answer appears in another question's prompt, options or explanation in the same quiz.",
    fix: 'Reword the other question, or choose a different concept for this one.',
  },
  'duplicate-answer-in-room': {
    problem: 'Two concepts in the quiz have the same answer.',
    fix: 'Replace one of the questions so each answer is asked once.',
  },
  'missing-according-to-your-notes': {
    problem: 'A choice question must start with "According to your notes".',
    fix: 'Begin the prompt with "According to your notes, …".',
  },
  'option-count': {
    problem: 'A choice question needs 3 or 4 options.',
    fix: 'Add or remove options so there are 3 or 4.',
  },
  'duplicate-options': {
    problem: 'Two options are the same after whitespace and case are normalised.',
    fix: 'Make every option different.',
  },
  'option-not-supported-or-contradicted': {
    problem: 'An option is not backed by quoted evidence that supports or contradicts it ("not mentioned" does not count).',
    fix: 'Give each option a quote that supports it or contradicts it, or replace the option.',
  },
  'option-without-evidence': {
    problem: 'An option has no evidence quote that resolves.',
    fix: 'Fix the option\'s paragraph and quote.',
  },
  'not-exactly-one-supported': {
    problem: 'Exactly one option must be labelled "supported". The rest must be "contradicted".',
    fix: 'Relabel or replace options so one is supported and the others are contradicted.',
  },
  'key-not-the-supported-option': {
    problem: 'The answer key does not name the option labelled "supported".',
    fix: 'Set `answer` to the id of the supported option.',
  },
  'step-count': {
    problem: 'An ordering question needs 3 to 5 steps.',
    fix: 'Use between 3 and 5 steps.',
  },
  'duplicate-steps': {
    problem: 'Two steps are the same after whitespace and case are normalised.',
    fix: 'Make every step different.',
  },
  'no-explicit-sequence-marker-in-quotes': {
    problem: 'None of the quotes states an order (no "first", "then", "next", numbering and so on).',
    fix: 'Only ask for an order the notes state outright. Otherwise set the question aside.',
  },
  'pair-count': {
    problem: 'A matching question needs 3 or 4 pairs.',
    fix: 'Use 3 or 4 pairs, each with its own quote.',
  },
  'not-one-to-one': {
    problem: 'A left item or a right item appears more than once, so the matching is not one to one.',
    fix: 'Give every left item and every right item exactly once.',
  },
  'item-count': {
    problem: 'An odd-one-out question needs exactly 4 items.',
    fix: 'Use four items: three that belong to the category and one that does not.',
  },
  'answer-not-an-item': {
    problem: 'The answer is not one of the four items, word for word.',
    fix: 'Set `answer` to the exact text of the odd item.',
  },
  'missing-category-rule': {
    problem: 'The category rule is empty or under 10 characters.',
    fix: 'State the category in a sentence, for example "The heart\'s four chambers are the atria and the ventricles."',
  },
  'needs-category-and-outside-quotes': {
    problem: 'The quotes do not include both one that sets the category and a different one that places the odd item outside it (wording such as "not", "unlike" or "outside", or the odd item itself).',
    fix: 'Add a quote that states why the odd item is outside the category, or set the question aside.',
  },
  'alternate-same-lock-type': {
    problem: "An alternate question must use a different lock type from its concept's primary.",
    fix: 'Change the alternate to another lock type.',
  },
  'max-one-alternate': {
    problem: 'A concept can have at most one alternate question.',
    fix: 'Drop the extra alternate.',
  },
  'alternate-off-concept': {
    problem: "The alternate's answer-bearing quote does not overlap any of the primary's quotes. This check is advisory.",
    fix: 'Check the alternate really asks about the same concept, and quote the same passage.',
  },
  'lock-type-not-supported': {
    problem: 'Combination dial questions are not checked yet, so this Power does not support them.',
    fix: 'Use rune-cipher, seance-board, bone-ordering, bound-threads or cursed-object.',
  },
};

const FALLBACK: CheckHint = {
  problem: 'A check this Power has no help text for failed.',
  fix: 'Read the Check_ID and the question, and fix or set the question aside.',
};

export function hintFor(checkId: CheckId): CheckHint {
  return HINTS[checkId] ?? FALLBACK;
}

/** Check IDs that are implemented in core's registry and so can appear in a result. */
export function implementedCheckIds(): readonly CheckId[] {
  return CHECK_REGISTRY.filter((r) => r.implemented).map((r) => r.id);
}

/** Check IDs whose failure is only advisory, and does not make a question fail. */
export function advisoryCheckIds(): ReadonlySet<CheckId> {
  return new Set(CHECK_REGISTRY.filter((r) => r.severity === 'advisory').map((r) => r.id));
}
