import type { CheckRegistration } from './types';

/** Change whenever the set or behaviour of Code_Checks changes. */
export const CHECK_VERSION = '2026-11-27.5';

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

const threads = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: ['bound-threads'],
  severity: 'blocking',
  implemented: true,
});

const cursed = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: ['cursed-object'],
  severity: 'blocking',
  implemented: true,
});

const dial = (id: CheckRegistration['id']): CheckRegistration => ({
  id,
  scope: ['combination-dial'],
  severity: 'blocking',
  implemented: true,
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
  // Phase 5 ids: registered so the registry equals the Req 3.5 list.
  // Deliberate flip (task 29.2): bone-ordering checks now exist and runChecks calls them.
  bone('step-count'),
  bone('duplicate-steps'),
  bone('no-explicit-sequence-marker-in-quotes'),
  // Deliberate flip (task 31.2): bound-threads checks now exist and runChecks calls them.
  threads('pair-count'),
  threads('not-one-to-one'),
  // Deliberate flip (task 33.3): cursed-object checks now exist and runChecks calls them.
  cursed('item-count'),
  cursed('answer-not-an-item'),
  cursed('missing-category-rule'),
  cursed('needs-category-and-outside-quotes'),
  // Deliberate flip (task 35.2): combination-dial checks now exist and runChecks calls them.
  // No registry entry is left unimplemented; lock-type-not-supported stays registered (Req 3.5).
  dial('missing-units'),
  dial('number-not-in-quote'),
  dial('range-not-in-quote'),
  dial('template-not-allowlisted'),
  dial('template-input-not-in-quote'),
  dial('template-value-mismatch'),
  dial('model-written-expression'),
  dial('dial-range-prompt'),
];
