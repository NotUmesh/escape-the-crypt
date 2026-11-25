import { checkQuote } from '../checks/evidence';
import type { CheckFailure } from '../checks/types';
import { normaliseWithMap } from '../normalise';
import type { Chunk } from '../types';

export const ACCORDING_TO_YOUR_NOTES = 'According to your notes';

export interface SeanceCheckContext {
  readonly chunks: ReadonlyMap<string, Chunk>;
  /** Authoring paragraph number -> code-assigned chunk ID (never includes heading-only chunks). */
  readonly paragraphChunkIds: ReadonlyMap<number, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface RawOption {
  readonly id: string;
  readonly text: string;
  readonly label: unknown;
  readonly evidence: unknown;
}

function readOption(value: unknown): RawOption {
  const o = isRecord(value) ? value : {};
  return { id: str(o['id']), text: str(o['text']), label: o['label'], evidence: o['evidence'] };
}

/** Returns the evidence's paragraph and quote when it has a non-empty quote, else null. */
function readEvidence(value: unknown): { paragraph: unknown; quote: string } | null {
  if (!isRecord(value)) return null;
  const quote = value['quote'];
  if (typeof quote !== 'string' || quote.trim() === '') return null;
  return { paragraph: value['paragraph'], quote };
}

function duplicateKey(text: string): string {
  return normaliseWithMap(text).text.toLowerCase();
}

/**
 * Code_Checks for a séance board question. Accepts unknown-shaped input so the
 * two defensive checks (option-not-supported-or-contradicted, option-without-evidence)
 * can run on raw model JSON before schema validation. Pure; never throws.
 * Order: prompt, option count, duplicates, labels, evidence presence,
 * exactly-one-supported, key, then each option's own quote.
 */
export function checkSeanceBoard(input: unknown, context: SeanceCheckContext): readonly CheckFailure[] {
  const q = isRecord(input) ? input : {};
  const questionId = str(q['id']);
  const failures: CheckFailure[] = [];
  const fail = (checkId: CheckFailure['checkId']): void => {
    failures.push({ checkId, questionId });
  };

  if (!str(q['prompt']).startsWith(ACCORDING_TO_YOUR_NOTES)) fail('missing-according-to-your-notes');

  const rawOptions: readonly unknown[] = Array.isArray(q['options']) ? q['options'] : [];
  const options = rawOptions.map(readOption);
  if (options.length < 3 || options.length > 4) fail('option-count');

  const keys = options.map((o) => duplicateKey(o.text));
  if (new Set(keys).size !== keys.length) fail('duplicate-options');

  if (options.some((o) => o.label !== 'supported' && o.label !== 'contradicted')) {
    fail('option-not-supported-or-contradicted');
  }

  const evidence = options.map((o) => readEvidence(o.evidence));
  if (evidence.some((e) => e === null)) fail('option-without-evidence');

  const supported = options.filter((o) => o.label === 'supported');
  if (supported.length !== 1) {
    fail('not-exactly-one-supported');
  } else if (supported[0]!.id !== str(q['answer'])) {
    fail('key-not-the-supported-option');
  }

  for (const e of evidence) {
    if (e === null) continue;
    const chunkId =
      typeof e.paragraph === 'number' ? context.paragraphChunkIds.get(e.paragraph) : undefined;
    const failure = checkQuote(
      context.chunks,
      { paragraphChunkId: chunkId ?? '', quote: e.quote },
      questionId,
    );
    if (failure) failures.push(failure);
  }

  return failures;
}
