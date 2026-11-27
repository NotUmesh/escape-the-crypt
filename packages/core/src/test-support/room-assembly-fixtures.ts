import fc from 'fast-check';
import type { AuthoringQuestion } from '../authoring/schema';
import type { AssemblyConcept } from '../pipeline/room-assembly';
import { prepareDocument, type PreparedDocument } from '../pipeline/prepare-input';

/** Shared generators for room-assembly tests. Every question maps: its quote is a whole paragraph sentence. */

export type Where = 'prompt' | 'option' | 'explanation';

export interface RoomPlan {
  /** One rune answer per concept; distinct, and never a word of the fixed filler text. */
  readonly answers: readonly string[];
  readonly primaryIsRune: readonly boolean[];
  readonly hasAlternate: readonly boolean[];
  /** At most one deliberately placed cross-concept leak. */
  readonly injection: {
    readonly source: number;
    readonly target: number;
    readonly targetRole: 'primary' | 'alternate';
    readonly where: Where;
  } | null;
}

export interface BuiltRoom {
  readonly document: PreparedDocument;
  readonly concepts: readonly AssemblyConcept[];
  readonly answers: readonly string[];
  /** True only when a rune answer was actually written into another concept's visible text. */
  readonly injected: boolean;
}

const answerArb = fc.stringMatching(/^[a-z]{5,9}$/).map((s) => `zq${s}`);

export const roomPlanArb: fc.Arbitrary<RoomPlan> = fc
  .integer({ min: 2, max: 5 })
  .chain((n) =>
    fc.record({
      answers: fc.uniqueArray(answerArb, { minLength: n, maxLength: n }),
      primaryIsRune: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      hasAlternate: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      injection: fc.option(
        fc.record({
          source: fc.integer({ min: 0, max: n - 1 }),
          target: fc.integer({ min: 0, max: n - 1 }),
          targetRole: fc.constantFrom('primary' as const, 'alternate' as const),
          where: fc.constantFrom('prompt' as const, 'option' as const, 'explanation' as const),
        }),
        { nil: null },
      ),
    }),
  );

function sentence(term: string): string {
  return `The ${term} is the structure that keeps the whole system running smoothly in the body.`;
}

function runeQuestion(
  conceptId: string,
  role: 'primary' | 'alternate',
  term: string,
  paragraph: number,
): AuthoringQuestion {
  return {
    id: `${conceptId}-${role}`,
    conceptId,
    role,
    lockType: 'rune-cipher',
    prompt: 'According to your notes, the ______ is the structure that keeps the system running.',
    answer: term,
    aliases: [],
    caseSensitive: false,
    evidence: [{ paragraph, quote: sentence(term) }],
    explanation: 'Your notes describe this structure directly.',
  };
}

function seanceQuestion(
  conceptId: string,
  role: 'primary' | 'alternate',
  term: string,
  paragraph: number,
): AuthoringQuestion {
  const evidence = { paragraph, quote: sentence(term) };
  return {
    id: `${conceptId}-${role}`,
    conceptId,
    role,
    lockType: 'seance-board',
    prompt: 'According to your notes, which statement about this structure matches the passage?',
    options: [
      { id: 'a', text: 'It keeps the whole system running smoothly', label: 'supported', evidence },
      { id: 'b', text: 'It stops the whole system from running', label: 'contradicted', evidence },
      { id: 'c', text: 'It only matters outside of the body', label: 'contradicted', evidence },
    ],
    answer: 'a',
    explanation: 'Your notes describe this structure directly.',
  };
}

function inject(question: AuthoringQuestion, answer: string, where: Where): AuthoringQuestion {
  if (where === 'option' && question.lockType === 'seance-board') {
    const [first, ...rest] = question.options;
    if (first === undefined) return question;
    const tainted = { ...first, text: `${first.text} like ${answer} does` };
    return { ...question, options: [tainted, ...rest] };
  }
  if (where === 'prompt') return { ...question, prompt: `${question.prompt} (${answer})` };
  return { ...question, explanation: `${question.explanation} See ${answer}.` };
}

/** Builds the document and concept list for a plan, applying the injection when it is valid. */
export function buildRoom(plan: RoomPlan): BuiltRoom {
  const n = plan.answers.length;
  const text = plan.answers.map(sentence).join('\n\n');
  const document = prepareDocument(text);
  const make = (
    i: number,
    role: 'primary' | 'alternate',
    rune: boolean,
  ): AuthoringQuestion => {
    const term = plan.answers[i] ?? '';
    return (rune ? runeQuestion : seanceQuestion)(`concept-${i}`, role, term, i + 1);
  };

  const inj = plan.injection;
  // A leak needs another concept as target, and a rune question as source.
  const sourceRune =
    inj !== null && inj.source !== inj.target && inj.source < n
      ? plan.primaryIsRune[inj.source] === true
      : false;
  let injected = false;

  const concepts: AssemblyConcept[] = [];
  for (let i = 0; i < n; i += 1) {
    const primaryRune = plan.primaryIsRune[i] === true;
    let primary = make(i, 'primary', primaryRune);
    let alternate = plan.hasAlternate[i] === true ? make(i, 'alternate', !primaryRune) : null;
    if (inj !== null && sourceRune && inj.target === i) {
      const answer = plan.answers[inj.source] ?? '';
      if (inj.targetRole === 'primary') {
        primary = inject(primary, answer, inj.where);
        injected = true;
      } else if (alternate !== null) {
        alternate = inject(alternate, answer, inj.where);
        injected = true;
      }
    }
    concepts.push({ conceptId: `concept-${i}`, label: `Concept ${i}`, primary, alternate });
  }
  return { document, concepts, answers: plan.answers, injected };
}
