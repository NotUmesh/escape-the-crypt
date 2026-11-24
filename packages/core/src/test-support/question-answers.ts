import type { QuestionSpec } from '../runtime/manifest-types';

interface OptionPayload {
  readonly optionIds: readonly string[];
  readonly keyOptionId?: string;
  readonly oddOneOutId?: string;
}

/**
 * A submission for a fixture question (built by `buildManifest`) that the judge rates
 * `correct` or `wrong`. For tests only; shapes follow `question-payloads.ts`.
 */
export function submissionFor(question: QuestionSpec, correct: boolean): unknown {
  switch (question.lockType) {
    case 'rune-cipher': {
      const p = question.payload as { answer: string };
      return { text: correct ? p.answer : 'no such rune' };
    }
    case 'seance-board': {
      const p = question.payload as OptionPayload;
      const key = p.keyOptionId ?? '';
      return { selectedOptionId: correct ? key : (p.optionIds.find((o) => o !== key) ?? null) };
    }
    case 'cursed-object': {
      const p = question.payload as OptionPayload;
      const key = p.oddOneOutId ?? '';
      return { selectedId: correct ? key : (p.optionIds.find((o) => o !== key) ?? null) };
    }
    case 'bone-ordering': {
      const p = question.payload as { itemIds: string[]; keyOrder: string[] };
      return { order: correct ? p.keyOrder : [...p.keyOrder].reverse() };
    }
    case 'bound-threads': {
      const p = question.payload as {
        leftIds: string[];
        rightIds: string[];
        keyPairs: [string, string][];
      };
      // Every left item tied once: the key pairs, or the rights shifted by one.
      return {
        pairs: correct
          ? p.keyPairs
          : p.leftIds.map((l, i) => [l, p.rightIds[i] ?? ''] as [string, string]),
      };
    }
    case 'combination-dial': {
      const p = question.payload as { exactValue: number };
      return { rawInput: correct ? String(p.exactValue) : String(p.exactValue + 100) };
    }
  }
}
