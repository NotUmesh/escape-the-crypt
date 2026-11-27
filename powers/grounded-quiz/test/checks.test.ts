import { describe, expect, it } from 'vitest';
import { CHECK_REGISTRY, CHECK_VERSION } from '../src/core-imports';
import { callTool } from '../src/tools';
import { byId, newContext, prepareHeart, run, sampleQuestions, supportedSampleQuestions } from './support';
import type { Json } from './support';

const list = (value: unknown): Json[] => value as Json[];

describe('check_question on the sample crypt', () => {
  it('passes every supported question in samples/questions/human-heart.json (all six lock types)', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const supported = supportedSampleQuestions();
    expect(new Set(supported.map((q) => q.lockType)).size).toBe(6);
    expect(supported.length).toBe(sampleQuestions().length);
    for (const question of supported) {
      const out = run('check_question', { notesId, question }, ctx);
      expect(out, question.id).toMatchObject({ valid: true, passes: true, blocking: [], questionId: question.id });
    }
  });

  it('says what it did not check', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const out = run('check_question', { notesId, question: byId('hh-q01') }, ctx);
    expect(JSON.stringify(out['notChecked'])).toContain('blind model review');
  });

  it('fails a question whose quote is not in the notes, with advice', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const question = { ...byId('hh-q01'), evidence: [{ paragraph: 6, quote: 'The valves between the atria and ventricles are called the mitral valves' }] };
    const out = run('check_question', { notesId, question }, ctx);
    expect(out['passes']).toBe(false);
    expect(list(out['blocking']).map((f) => f['checkId'])).toContain('quote-not-found');
    expect(String(list(out['blocking'])[0]?.['fix'])).toContain('Copy the quote exactly');
  });

  it('fails an answer that leaks into the prompt', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const question = { ...byId('hh-q01'), prompt: 'According to your notes, the atrioventricular valves are called the ______ valves.' };
    expect(list(run('check_question', { notesId, question }, ctx)['blocking']).map((f) => f['checkId'])).toContain('answer-leak-in-prompt');
  });

  it('fails a negative question', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const question = { ...byId('hh-q01'), prompt: 'According to your notes, which valves are not the ______ valves?' };
    expect(list(run('check_question', { notesId, question }, ctx)['blocking']).map((f) => f['checkId'])).toContain('negative-question');
  });

  it('fails an answer that is not in the quote', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const question = { ...byId('hh-q01'), answer: 'mitral', aliases: [] };
    expect(list(run('check_question', { notesId, question }, ctx)['blocking']).map((f) => f['checkId'])).toContain('answer-not-in-quote');
  });

  it('fails a choice question with two supported options, or without the opening words', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const seance = byId('hh-q03') as unknown as { options: Json[]; prompt: string };
    const twoSupported = { ...seance, options: seance.options.map((o) => ({ ...o, label: 'supported' })) };
    expect(list(run('check_question', { notesId, question: twoSupported }, ctx)['blocking']).map((f) => f['checkId'])).toContain('not-exactly-one-supported');
    const noFraming = { ...seance, prompt: seance.prompt.replace('According to your notes', 'In your opinion') };
    expect(list(run('check_question', { notesId, question: noFraming }, ctx)['blocking']).map((f) => f['checkId'])).toContain('missing-according-to-your-notes');
  });

  it('fails a bone-ordering question with an order the quotes do not state', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const ordering = byId('hh-q05') as unknown as { evidence: { paragraph: number; quote: string }[] };
    const noMarker = { ...ordering, evidence: [{ paragraph: 4, quote: 'The right atrium receives oxygen-poor blood returning from the body' }] };
    const ids = list(run('check_question', { notesId, question: noMarker }, ctx)['blocking']).map((f) => f['checkId']);
    expect(ids).toContain('no-explicit-sequence-marker-in-quotes');
  });

  it('reports a cited paragraph that does not exist', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const question = { ...byId('hh-q01'), evidence: [{ paragraph: 40, quote: 'The valves between the atria and ventricles are called the atrioventricular valves' }] };
    expect(list(run('check_question', { notesId, question }, ctx)['blocking']).map((f) => f['checkId'])).toContain('unknown-paragraph/chunk');
  });

  it('says where a malformed question goes wrong, without echoing its values', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const bad = { ...byId('hh-q01'), answer: '' , secretNote: 'DO-NOT-ECHO' };
    const out = run('check_question', { notesId, question: bad }, ctx);
    expect(out['valid']).toBe(false);
    expect(JSON.stringify(out)).not.toContain('DO-NOT-ECHO');
    expect(String(out['hint'])).toContain('rune-cipher, seance-board, bone-ordering');
  });

  it('supports combination dial questions: the sample dial questions pass', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const dials = sampleQuestions().filter((q) => q.lockType === 'combination-dial');
    expect(dials.length).toBeGreaterThanOrEqual(2);
    for (const question of dials) {
      expect(run('check_question', { notesId, question }, ctx), question.id).toMatchObject({ valid: true, passes: true, blocking: [] });
    }
  });
  describe('combination dial failures, each with advice', () => {
    const blocking = (question: unknown): string[] => {
      const ctx = newContext();
      const { notesId } = prepareHeart(ctx);
      const out = run('check_question', { notesId, question }, ctx);
      expect(out['valid']).toBe(true);
      for (const finding of list(out['blocking'])) {
        expect(String(finding['problem']).length).toBeGreaterThan(20);
        expect(String(finding['fix']).length).toBeGreaterThan(10);
      }
      return list(out['blocking']).map((f) => String(f['checkId']));
    };
    const range = byId('hh-q11') as unknown as Json;
    const exact = byId('hh-q10') as unknown as Json;
    const template = {
      ...exact,
      id: 'dial-t',
      role: 'primary',
      prompt: 'According to your notes, how many beats per minute separate the top of the normal resting heart rate from the bottom?',
      answer: { kind: 'template', template: 'difference', inputs: [100, 60], value: 40 },
      units: 'beats per minute',
      evidence: [{ paragraph: 9, quote: 'a normal heart rate is between 60 and 100 beats per minute' }],
    } as Json;
    it('passes a computed answer whose value code agrees with', () => {
      expect(blocking(template)).toEqual([]);
    });
    it('fails blank units (missing-units)', () => {
      expect(blocking({ ...exact, units: '  ' })).toEqual(['missing-units']);
    });
    it('fails an exact number the quote does not state (number-not-in-quote)', () => {
      expect(blocking({ ...exact, answer: { kind: 'exact', value: 5 } })).toEqual(['number-not-in-quote']);
    });
    it('fails a range whose ends are not both in a quote, or that is reversed (range-not-in-quote)', () => {
      expect(blocking({ ...range, answer: { kind: 'range', min: 60, max: 120 } })).toEqual(['range-not-in-quote']);
      expect(blocking({ ...range, answer: { kind: 'range', min: 100, max: 60 } })).toEqual(['range-not-in-quote']);
    });
    it('fails a range prompt that asks for both ends (dial-range-prompt)', () => {
      expect(blocking({ ...range, prompt: 'According to your notes, what are the minimum and maximum resting heart rates?' })).toEqual(['dial-range-prompt']);
    });
    it('fails a template whose inputs are not in the quote (template-input-not-in-quote)', () => {
      expect(blocking({ ...template, answer: { kind: 'template', template: 'difference', inputs: [100, 50], value: 50 } })).toEqual(['template-input-not-in-quote']);
    });
    it('fails a template value that code does not recompute (template-value-mismatch)', () => {
      expect(blocking({ ...template, answer: { kind: 'template', template: 'difference', inputs: [100, 60], value: 41 } })).toEqual(['template-value-mismatch']);
    });
    it('rejects an unlisted template or an expression, naming the schema, never running anything', () => {
      const ctx = newContext();
      const { notesId } = prepareHeart(ctx);
      for (const answer of [
        { kind: 'template', template: 'power', inputs: [100, 60], value: 40 },
        { kind: 'exact', value: 4, expression: '2+2' },
      ]) {
        const out = run('check_question', { notesId, question: { ...exact, answer } }, ctx);
        expect(out['valid']).toBe(false);
        expect(String(out['hint'])).toContain('combination-dial');
      }
    });
  });
  it('lists the six lock types and the dial checks', () => {
    const out = run('list_checks', {}, newContext());
    expect(out['supportedLockTypes']).toEqual([
      'rune-cipher',
      'seance-board',
      'bone-ordering',
      'bound-threads',
      'cursed-object',
      'combination-dial',
    ]);
    const ids = list(out['checks']).map((c) => String(c['id']));
    for (const id of ['missing-units', 'number-not-in-quote', 'range-not-in-quote', 'template-not-allowlisted', 'template-input-not-in-quote', 'template-value-mismatch', 'model-written-expression', 'dial-range-prompt']) {
      expect(ids).toContain(id);
    }
  });
  it('fails a matching question that uses a right-hand item twice', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const threads = byId('hh-q07') as unknown as { pairs: Json[] };
    const twice = { ...threads, pairs: threads.pairs.map((p, i) => (i === 1 ? { ...p, right: String((threads.pairs[0] as Json)['right']) } : p)) };
    expect(list(run('check_question', { notesId, question: twice }, ctx)['blocking']).map((f) => f['checkId'])).toContain('not-one-to-one');
  });

  it('fails an odd-one-out question whose answer is not one of its items, or whose quotes never place it outside', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const cursed = byId('hh-q09') as unknown as { evidence: Json[] };
    const wrongAnswer = { ...cursed, answer: 'Mitral valve' };
    expect(list(run('check_question', { notesId, question: wrongAnswer }, ctx)['blocking']).map((f) => f['checkId'])).toContain('answer-not-an-item');
    const oneQuote = { ...cursed, evidence: [cursed.evidence[0]] };
    expect(list(run('check_question', { notesId, question: oneQuote }, ctx)['blocking']).map((f) => f['checkId'])).toContain('needs-category-and-outside-quotes');
  });
});

describe('check_quiz', () => {
  it('passes the supported questions of the sample crypt together, with only the advisory alternate notes', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const supported = supportedSampleQuestions();
    const out = run('check_quiz', { notesId, questions: supported }, ctx);
    expect(out['passes']).toBe(true);
    expect(out['summary']).toEqual({ total: supported.length, passing: supported.length, failing: 0, invalid: 0, blockingByCheckId: {} });
  });

  it('catches two concepts with the same answer', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const one = byId('hh-q01');
    const two = { ...one, id: 'dup-1', conceptId: 'other-concept' };
    const out = run('check_quiz', { notesId, questions: [one, two] }, ctx);
    expect(out['passes']).toBe(false);
    expect((out['summary'] as Json)['blockingByCheckId']).toHaveProperty('duplicate-answer-in-room');
  });

  it("catches an answer that appears in another concept's question", () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const one = byId('hh-q01');
    const leaky = { ...byId('hh-q12'), id: 'leaky', prompt: `${String((byId('hh-q12') as Json)['prompt'])} (Hint: think of the atrioventricular valves.)` };
    const out = run('check_quiz', { notesId, questions: [one, leaky] }, ctx);
    expect((out['summary'] as Json)['blockingByCheckId']).toHaveProperty('answer-leak-in-room');
  });

  it('reports a malformed item by position, and keeps checking the rest', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const out = run('check_quiz', { notesId, questions: [byId('hh-q01'), { id: 'x' }] }, ctx);
    expect(out['passes']).toBe(false);
    expect(list(out['invalid'])[0]).toMatchObject({ index: 1 });
    expect(list(out['questions'])).toHaveLength(1);
  });

  it('refuses an empty list, a list over 40, and repeated ids', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    expect(callTool('check_quiz', { notesId, questions: [] }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(callTool('check_quiz', { notesId, questions: Array.from({ length: 41 }, () => byId('hh-q01')) }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(callTool('check_quiz', { notesId, questions: [byId('hh-q01'), byId('hh-q01')] }, ctx)).toMatchObject({ ok: false, error: { code: 'duplicate-question-id' } });
  });
});

describe('list_checks and the dispatcher', () => {
  it('lists every implemented check once, with help text and the current check version', () => {
    const out = run('list_checks', {}, newContext());
    const checks = list(out['checks']);
    const implemented = CHECK_REGISTRY.filter((r) => r.implemented).map((r) => r.id);
    expect(checks.map((c) => c['id']).sort()).toEqual([...implemented].sort());
    expect(out['checkVersion']).toBe(CHECK_VERSION);
    for (const c of checks) {
      expect(String(c['problem']).length, String(c['id'])).toBeGreaterThan(10);
      expect(String(c['fix']).length, String(c['id'])).toBeGreaterThan(5);
    }
  });

  it('refuses an unknown tool and non-object arguments, and never throws', () => {
    const ctx = newContext();
    expect(callTool('nope', {}, ctx)).toMatchObject({ ok: false, error: { code: 'unknown-tool' } });
    for (const args of [null, 'text', 7, []]) {
      expect(callTool('list_checks', args, ctx)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
  });
});
