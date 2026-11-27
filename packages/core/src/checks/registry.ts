import type { CheckRegistration } from './types';

/** Change whenever the set or behaviour of Code_Checks changes. */
export const CHECK_VERSION = '2026-11-27.2';

const shared = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: 'shared',
  severity: 'blocking',
  implemented: true,
});

const rune = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: ['rune-cipher'],
  severity: 'blocking',
  implemented: true,
});

const seance = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: ['seance-board'],
  severity: 'blocking',
  implemented: true,
});

const bone = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: ['bone-ordering'],
  severity: 'blocking',
  implemented: true,
});

/** Not yet implemented. Bone ordering is implemented, so it has its own helper (`bone`). */
const later = (
  id: CheckRegistration['id'],
  lockType: 'bound-threads' | 'cursed-object' | 'combination-dial',
): CheckRegistration => ({
  id,
  scope: [lockType],
  severity: 'blocking',
  implemented: false,
});

export const CHECK_REGISTRY: readonly CheckRegistration[] = [
  shared('quote-not-found'),
  shared('quote-ambiguous'),
  shared('quote-too-short'),
  shared('quote-too-long'),
  shared('unknown-paragraph/chunk'),
  shared('banned-phrase'),
  shared('negative-question'),
  rune('rune-needs-one-blank'),
  rune('answer-not-in-quote'),
  rune('answer-leak-in-prompt'),
  rune('answer-leak-in-room'),
  // Room-level, like the Leak_Scan: two concepts in one crypt never share an answer.
  shared('duplicate-answer-in-room'),
  seance('missing-according-to-your-notes'),
  seance('option-count'),
  seance('duplicate-options'),
  seance('option-not-supported-or-contradicted'),
  seance('option-without-evidence'),
  seance('not-exactly-one-supported'),
  seance('key-not-the-supported-option'),
  shared('alternate-same-lock-type'),
  shared('max-one-alternate'),
  { id: 'alternate-off-concept', scope: 'shared', severity: 'advisory', implemented: true },
  shared('lock-type-not-supported'),
  // Phase 5 ids: registered now so the registry equals the Req 3.5 list.
  // Until their checks exist, questions of these types fail with lock-type-not-supported.
  // Deliberate flip (task 29.2): bone-ordering checks now exist and runChecks calls them.
  bone('step-count'),
  bone('duplicate-steps'),
  bone('no-explicit-sequence-marker-in-quotes'),
  later('pair-count', 'bound-threads'),
  later('not-one-to-one', 'bound-threads'),
  later('item-count', 'cursed-object'),
  later('answer-not-an-item', 'cursed-object'),
  later('missing-category-rule', 'cursed-object'),
  later('needs-category-and-outside-quotes', 'cursed-object'),
  later('missing-units', 'combination-dial'),
  later('number-not-in-quote', 'combination-dial'),
  later('range-not-in-quote', 'combination-dial'),
  later('template-not-allowlisted', 'combination-dial'),
  later('template-input-not-in-quote', 'combination-dial'),
  later('template-value-mismatch', 'combination-dial'),
  later('model-written-expression', 'combination-dial'),
  later('dial-range-prompt', 'combination-dial'),
];
