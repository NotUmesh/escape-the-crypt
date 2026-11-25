import type { LockType } from '../types';

export type CheckId =
  | 'quote-not-found'
  | 'quote-ambiguous'
  | 'quote-too-short'
  | 'quote-too-long'
  | 'unknown-paragraph/chunk'
  | 'missing-according-to-your-notes'
  | 'negative-question'
  | 'banned-phrase'
  | 'answer-not-in-quote'
  | 'rune-needs-one-blank'
  | 'answer-leak-in-prompt'
  | 'answer-leak-in-room'
  | 'option-count'
  | 'option-not-supported-or-contradicted'
  | 'option-without-evidence'
  | 'not-exactly-one-supported'
  | 'key-not-the-supported-option'
  | 'duplicate-options'
  | 'step-count'
  | 'duplicate-steps'
  | 'no-explicit-sequence-marker-in-quotes'
  | 'pair-count'
  | 'not-one-to-one'
  | 'item-count'
  | 'answer-not-an-item'
  | 'missing-category-rule'
  | 'needs-category-and-outside-quotes'
  | 'missing-units'
  | 'number-not-in-quote'
  | 'range-not-in-quote'
  | 'template-not-allowlisted'
  | 'template-input-not-in-quote'
  | 'template-value-mismatch'
  | 'model-written-expression'
  | 'alternate-same-lock-type'
  | 'max-one-alternate'
  | 'dial-range-prompt'
  | 'alternate-off-concept'
  | 'lock-type-not-supported';

export type CheckSeverity = 'blocking' | 'advisory';

export type CheckScope = readonly LockType[] | 'shared';

export interface CheckRegistration {
  readonly id: CheckId;
  /** 'shared' checks run for every supported lock type. */
  readonly scope: CheckScope;
  readonly severity: CheckSeverity;
  /** True once the check function exists. Phase 5 flips the four later lock types. */
  readonly implemented: boolean;
}

/** One failure. Pure data; never thrown. */
export interface CheckFailure {
  readonly checkId: CheckId;
  readonly questionId: string;
}
