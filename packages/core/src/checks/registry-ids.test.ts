import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY, CHECK_VERSION } from './registry';

/** The literal Req 3.5 list, in the order the requirement gives it. */
const REQ_3_5_CHECK_IDS: readonly string[] = [
  'quote-not-found', 'quote-ambiguous', 'quote-too-short',
  'quote-too-long', 'unknown-paragraph/chunk', 'missing-according-to-your-notes',
  'negative-question', 'banned-phrase', 'answer-not-in-quote',
  'rune-needs-one-blank', 'answer-leak-in-prompt', 'answer-leak-in-room', 'duplicate-answer-in-room',
  'option-count', 'option-not-supported-or-contradicted', 'option-without-evidence',
  'not-exactly-one-supported', 'key-not-the-supported-option', 'duplicate-options',
  'step-count', 'duplicate-steps', 'no-explicit-sequence-marker-in-quotes', 'steps-listed-in-prompt',
  'pair-count', 'not-one-to-one', 'item-count',
  'answer-not-an-item', 'missing-category-rule', 'needs-category-and-outside-quotes',
  'missing-units', 'units-reveal-number', 'number-not-in-quote', 'range-not-in-quote',
  'template-not-allowlisted', 'template-input-not-in-quote', 'template-value-mismatch',
  'model-written-expression', 'alternate-same-lock-type', 'max-one-alternate',
  'dial-range-prompt', 'alternate-off-concept', 'lock-type-not-supported',
];

const registryIds = CHECK_REGISTRY.map((r) => r.id as string);
describe('check registry', () => {
  it('has exactly the Req 3.5 Check_IDs, with no missing, extra or duplicate id', () => {
    const missing = REQ_3_5_CHECK_IDS.filter((id) => !registryIds.includes(id));
    const extra = registryIds.filter((id) => !REQ_3_5_CHECK_IDS.includes(id));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(new Set(registryIds).size).toBe(registryIds.length);
    expect(registryIds).toHaveLength(REQ_3_5_CHECK_IDS.length);
  });

  it('exposes a date-style CHECK_VERSION', () => expect(CHECK_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/));

  it('marks only alternate-off-concept as advisory', () => {
    const advisory = CHECK_REGISTRY.filter((r) => r.severity === 'advisory').map((r) => r.id);
    expect(advisory).toEqual(['alternate-off-concept']);
  });
});
