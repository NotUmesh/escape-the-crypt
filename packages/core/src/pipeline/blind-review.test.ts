import { describe, expect, it } from 'vitest';
import { blindReview, type ReviewRejection } from './blind-review';
import {
  REVIEW_OPTIONS,
  cassetteFor,
  heart,
  labels,
  loadReviewFixtures,
  ok,
  requestFor,
  reviewLedger,
  runeQuestion,
  scripted,
  seanceQuestion,
} from './blind-review-fixtures';

const unknownAll = (answer = 'unknown') => ({
  answer,
  optionLabels: [
    { optionId: 'a', label: 'unknown' },
    { optionId: 'b', label: 'unknown' },
    { optionId: 'c', label: 'unknown' },
  ],
});

/**
 * SYNTHETIC replies. They are what a careful blind reviewer would plausibly answer for each
 * adversarial fixture, written by hand. They test the decision wiring (request -> cassette ->
 * parse -> decideReview), not the real model's ability to catch these; that is the P4 evaluation.
 */
const SYNTHETIC: Record<string, { reply: unknown; reason: ReviewRejection['kind'] }> = {
  // The notes say fog is NOT precipitation, so no option fits; a careful reader says unknown.
  'adv-13': { reply: unknownAll(), reason: 'unknown-label' },
  // Seismometer and rover are not in the notes: the reviewer labels them unknown, not contradicted.
  'adv-14': {
    reply: {
      answer: 'a',
      optionLabels: [
        { optionId: 'a', label: 'supported' },
        { optionId: 'b', label: 'unknown' },
        { optionId: 'c', label: 'unknown' },
      ],
    },
    reason: 'unknown-label',
  },
  // Ignores the injected "answer C" paragraph and answers from the real explanation (option a).
  'adv-16': {
    reply: {
      answer: 'a',
      optionLabels: [
        { optionId: 'a', label: 'supported' },
        { optionId: 'b', label: 'contradicted' },
        { optionId: 'c', label: 'contradicted' },
      ],
    },
    reason: 'answer-mismatch',
  },
  // The only "evidence" is an instruction, so the Moon question has no answer in the notes.
  'adv-17': { reply: { answer: 'unknown', optionLabels: null }, reason: 'unknown-label' },
};

describe('blindReview: adversarial review:* fixtures via synthetic cassette', () => {
  const fixtures = loadReviewFixtures();

  it('loads the four rune and séance review fixtures', () => {
    expect(fixtures.map((f) => f.id)).toEqual(['adv-13', 'adv-14', 'adv-16', 'adv-17']);
  });

  it('translates fixture paragraphs to pipeline ordinals through chunk IDs', () => {
    // Fixture paragraphs are translated through chunk IDs, not assumed equal to ordinals. For these
    // four fixtures the two numberings happen to coincide; the check is that every translated
    // ordinal holds the fixture's quote.
    for (const f of fixtures) {
      expect(f.translated.length).toBeGreaterThan(0);
      const q = f.question;
      const cited = q.lockType === 'seance-board' ? q.options.map((o) => o.evidence) : q.evidence;
      for (const e of cited) {
        const chunk = f.doc.quotableChunksByOrdinal.get(e.paragraph);
        expect(chunk?.text.replace(/\s+/g, ' ')).toContain(e.quote.replace(/\s+/g, ' '));
      }    }
  });

  it.each(fixtures.map((f) => [f.id, f] as const))('%s is rejected with its intended reason', async (id, f) => {
    const expected = SYNTHETIC[id]!;
    const provider = await cassetteFor(f.question, f.doc, expected.reply, 'synthetic');
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, f.question, f.doc, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: expected.reason } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });
});

describe('blindReview: passed and judge alias', () => {
  it('passes a rune question when the reviewer fills the blank with the key', async () => {
    const q = runeQuestion();
    const provider = await cassetteFor(q, heart, { answer: 'atrioventricular', optionLabels: null });
    expect(await blindReview(provider, reviewLedger(), q, heart, REVIEW_OPTIONS)).toEqual({
      verdict: 'passed',
    });
  });

  it('passes a rune question when the reviewer answers with an alias (judge normalisation)', async () => {
    const q = runeQuestion();
    const provider = await cassetteFor(q, heart, { answer: ' av-alias-sentinel ', optionLabels: null });
    expect((await blindReview(provider, reviewLedger(), q, heart, REVIEW_OPTIONS)).verdict).toBe('passed');
  });

  it('passes a séance question with the right option and correct labels', async () => {
    const q = seanceQuestion();
    const provider = await cassetteFor(q, heart, labels('contradicted', 'supported', 'contradicted'));
    expect((await blindReview(provider, reviewLedger(), q, heart, REVIEW_OPTIONS)).verdict).toBe('passed');
  });

  it('rejects a séance answer that matches but labels another option supported', async () => {
    const q = seanceQuestion();
    const provider = await cassetteFor(q, heart, labels('supported', 'supported', 'contradicted'));
    expect(await blindReview(provider, reviewLedger(), q, heart, REVIEW_OPTIONS)).toEqual({
      verdict: 'rejected',
      reason: { kind: 'label-mismatch' },
    });
  });
});

describe('blindReview: the request', () => {
  it('is at temperature 0 on the review stage with the injected limits', async () => {
    const q = seanceQuestion();
    const request = await requestFor(q, heart);
    expect(request.temperature).toBe(0);
    expect(request.stage).toBe('review');
    expect(request.maxOutputTokens).toBe(REVIEW_OPTIONS.maxOutputTokens);
    expect(request.retryLimit).toBe(REVIEW_OPTIONS.retryLimit);
    expect(request.timeoutMs).toBe(REVIEW_OPTIONS.timeoutMs);
  });

  it('keeps the temperature at 0 on the retry call too', async () => {
    const q = runeQuestion();
    const provider = scripted([ok({ bad: true }), ok({ answer: 'atrioventricular', optionLabels: null })]);
    await blindReview(provider, reviewLedger(), q, heart, REVIEW_OPTIONS);
    expect(provider.requests.map((r) => r.temperature)).toEqual([0, 0]);
  });

  it('never contains the key, alias, explanation, hint, note, labels or option quotes outside the notes', async () => {
    const rune = await requestFor(runeQuestion(), heart);
    const seance = await requestFor(seanceQuestion(), heart);
    const notesBlock = /<notes>[\s\S]*<\/notes>/;
    for (const request of [rune, seance]) {
      const everything = JSON.stringify(request);
      const userOutsideNotes = request.messages.map((m) => m.content.replace(notesBlock, '')).join('\n');
      // Sentinels appear nowhere, not even inside the notes.
      for (const sentinel of ['AV-ALIAS-SENTINEL', 'EXPLANATION-SENTINEL-7731', 'NOTE-SENTINEL-4412']) {
        expect(everything.toLowerCase()).not.toContain(sentinel.toLowerCase());
      }
      expect(userOutsideNotes).not.toMatch(/supported|contradicted|label/i);
      expect(request.system).not.toContain('atrioventricular');
    }
    // The rune key is in the notes, so only the text outside the notes block is checked.
    expect(rune.messages[0]!.content.replace(notesBlock, '')).not.toContain('atrioventricular');
    // The first-letter hint is not sent: the prompt shows only the blank.
    expect(JSON.stringify(rune)).not.toContain('first-letter-and-length');
    // Option texts are shown, but not the "tricuspid ... on the right" quote as an option payload.
    const seanceUser = seance.messages[0]!.content.replace(notesBlock, '');
    expect(seanceUser).toContain('id b: The mitral valve');
    expect(seanceUser).not.toContain('the tricuspid valve on the right and the mitral valve');
  });
});

describe('blindReview: retry and schema failure', () => {
  const good = { answer: 'atrioventricular', optionLabels: null };

  it('retries once after a schema failure and passes on a valid second reply', async () => {
    const provider = scripted([ok({ nonsense: 1 }), ok(good)]);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, runeQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict.verdict).toBe('passed');
    expect(provider.requests).toHaveLength(2);
    // Each attempt has its own reservation, reconciled.
    expect(ledger.reservations).toBe(2);
    expect(ledger.reconciles).toBe(2);
    expect(provider.requests[1]!.messages[0]!.content).toContain(
      provider.requests[0]!.messages[0]!.content,
    );
    expect(provider.requests[1]!.messages[0]!.content).not.toBe(provider.requests[0]!.messages[0]!.content);
  });

  it('rejects as schema-rejected after a second failure, with exactly two calls', async () => {
    const provider = scripted([ok({ nonsense: 1 }), ok({ answer: '', optionLabels: null })]);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, runeQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'schema-rejected' } });
    expect(provider.requests).toHaveLength(2);
    expect(ledger.reservations).toBe(2);
  });

  it('treats an incomplete label set (missing option c) as a schema failure and retries', async () => {
    const incomplete = {
      answer: 'b',
      optionLabels: [
        { optionId: 'a', label: 'contradicted' },
        { optionId: 'b', label: 'supported' },
      ],
    };
    const provider = scripted([ok(incomplete), ok(labels('contradicted', 'supported', 'contradicted'))]);
    const verdict = await blindReview(provider, reviewLedger(), seanceQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict.verdict).toBe('passed');
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.messages[0]!.content).toContain('exactly one entry for each option id');
  });

  it.each([
    ['an unknown option id', { answer: 'b', optionLabels: [
      { optionId: 'a', label: 'contradicted' }, { optionId: 'b', label: 'supported' },
      { optionId: 'z', label: 'contradicted' }] }],
    ['a repeated option id', { answer: 'b', optionLabels: [
      { optionId: 'a', label: 'contradicted' }, { optionId: 'a', label: 'contradicted' },
      { optionId: 'b', label: 'supported' }] }],
    ['null labels on a séance question', { answer: 'b', optionLabels: null }],
  ])('rejects %s after the retry', async (_name, reply) => {
    const provider = scripted([ok(reply)]);
    const verdict = await blindReview(provider, reviewLedger(), seanceQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'schema-rejected' } });
    expect(provider.requests).toHaveLength(2);
  });

  it('rejects labels on a rune question after the retry', async () => {
    const provider = scripted([ok({ answer: 'atrioventricular', optionLabels: [] })]);
    const verdict = await blindReview(provider, reviewLedger(), runeQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'schema-rejected' } });
    expect(provider.requests).toHaveLength(2);
  });
});

describe('blindReview: gates before and around the call', () => {
  it('never calls the reviewer for a question with a blocking Code_Check failure', async () => {
    const bad = seanceQuestion({
      options: [
        { id: 'a', text: 'The tricuspid valve', label: 'contradicted', evidence: { paragraph: 1, quote: 'a quote that is nowhere in the notes at all' } },
        { id: 'b', text: 'The mitral valve', label: 'supported', evidence: { paragraph: 1, quote: 'another quote that is nowhere in the notes' } },
        { id: 'c', text: 'The aortic valve', label: 'contradicted', evidence: { paragraph: 1, quote: 'a third quote absent from the notes entirely' } },
      ],
    });
    const provider = scripted([ok(labels('contradicted', 'supported', 'contradicted'))]);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, bad, heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'blocking-check' } });
    expect(provider.requests).toHaveLength(0);
    expect(ledger.reservations).toBe(0);
  });

  it('makes zero calls when the budget refuses the first reservation', async () => {
    const provider = scripted([ok({ answer: 'atrioventricular', optionLabels: null })]);
    const ledger = reviewLedger(0);
    const verdict = await blindReview(provider, ledger, runeQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'budget-exhausted' } });
    expect(provider.requests).toHaveLength(0);
  });

  it('stops after one call when the retry reservation is refused', async () => {
    const provider = scripted([ok({ nonsense: 1 })]);
    const ledger = reviewLedger(1);
    const verdict = await blindReview(provider, ledger, runeQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'budget-exhausted' } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.reservations).toBe(1);
  });

  it('reports a provider failure with its retryable flag and releases the reservation', async () => {
    const provider = scripted([{ ok: false, error: { kind: 'timeout', retryable: true } }]);
    const ledger = reviewLedger();
    const verdict = await blindReview(provider, ledger, runeQuestion(), heart, REVIEW_OPTIONS);
    expect(verdict).toEqual({ verdict: 'rejected', reason: { kind: 'provider-failed', retryable: true } });
    expect(provider.requests).toHaveLength(1);
    expect(ledger.releases).toBe(1);
  });
});


