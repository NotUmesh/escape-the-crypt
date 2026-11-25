import type { Result } from '../types';
import { AuthoringQuestionSchema, type AuthoringQuestion } from './schema';

export type AuthoringParseError = {
  readonly kind: 'invalid-authoring-question';
  /** Dot-joined path of the first failing field; empty for a root-level failure. */
  readonly path: string;
};

/** Validates one authoring question. Never throws. */
export function parseAuthoringQuestion(value: unknown): Result<AuthoringQuestion, AuthoringParseError> {
  try {
    const parsed = AuthoringQuestionSchema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data };
    const first = parsed.error.issues[0];
    // Unknown-key issues carry the parent path; append the key so the field is named.
    const keys = first && first.code === 'unrecognized_keys' ? first.keys : [];
    const path = first ? [...first.path, ...keys.slice(0, 1)].join('.') : '';
    return { ok: false, error: { kind: 'invalid-authoring-question', path } };
  } catch {
    return { ok: false, error: { kind: 'invalid-authoring-question', path: '' } };
  }
}
