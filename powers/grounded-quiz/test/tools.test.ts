import { describe, expect, it } from 'vitest';
import { CHECK_VERSION, MAX_EXTRACTED_WORDS } from '../src/core-imports';
import { callTool } from '../src/tools';
import { HUMAN_HEART, newContext, prepareHeart, run } from './support';
import type { Json } from './support';

const list = (value: unknown): Json[] => value as Json[];

describe('prepare_notes on samples/human-heart.txt', () => {
  it('numbers the paragraphs and returns their text', () => {
    const { notesId, value } = prepareHeart(newContext());
    expect(notesId).toMatch(/^notes_[0-9a-f]{12}$/);
    expect(value['paragraphCount']).toBe(9);
    expect(value['wordCount']).toBe(325);
    expect(value['checkVersion']).toBe(CHECK_VERSION);
    const paragraphs = list(value['paragraphs']);
    expect(paragraphs.map((p) => p['paragraph'])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(String(paragraphs[5]?.['text'])).toContain('atrioventricular valves');
    for (const p of paragraphs) expect(String(p['chunkId'])).toMatch(/^chk_/);
  });

  it('gives the same id for the same notes, and a different one for different notes', () => {
    const a = prepareHeart(newContext()).notesId;
    const b = prepareHeart(newContext()).notesId;
    const other = run('prepare_notes', { text: `${HUMAN_HEART}\n\nOne more paragraph about the valves of the heart.` }, newContext());
    expect(a).toBe(b);
    expect(other['notesId']).not.toBe(a);
  });

  it('states the quote rules the checks enforce', () => {
    expect(prepareHeart(newContext()).value['quoteRules']).toEqual({ minWords: 4, minChars: 20, maxWords: 25 });
  });

  it('refuses empty notes, notes over the word limit, and non-string text', () => {
    const ctx = newContext();
    expect(callTool('prepare_notes', { text: '   \n' }, ctx)).toMatchObject({ ok: false, error: { code: 'empty-notes' } });
    const long = Array.from({ length: MAX_EXTRACTED_WORDS + 1 }, () => 'word').join(' ');
    expect(callTool('prepare_notes', { text: long }, ctx)).toMatchObject({ ok: false, error: { code: 'too-many-words' } });
    expect(callTool('prepare_notes', { text: 42 }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    expect(callTool('prepare_notes', {}, ctx)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
  });

  it('keeps nothing when it refuses', () => {
    const ctx = newContext();
    callTool('prepare_notes', { text: '' }, ctx);
    expect(ctx.store.size).toBe(0);
  });
});

describe('resolve_quote', () => {
  const quote = 'The valves between the atria and ventricles are called the atrioventricular valves';

  it('finds an exact quote once and says where', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const out = run('resolve_quote', { notesId, paragraph: 6, quote }, ctx);
    expect(out).toMatchObject({ resolves: true, paragraph: 6, lengthOk: true, label: 'Source excerpt matched' });
    expect(out['matchedText']).toBe(quote);
    expect(Number(out['end']) - Number(out['start'])).toBe(quote.length);
  });

  it('accepts extra spaces and a different line wrapping, because it normalises first', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const messy = 'The  valves between\nthe atria   and ventricles are called the atrioventricular valves';
    expect(run('resolve_quote', { notesId, paragraph: 6, quote: messy }, ctx)['resolves']).toBe(true);
  });

  it('explains each way a quote can fail', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    const failing = (paragraph: number, text: string): Json => run('resolve_quote', { notesId, paragraph, quote: text }, ctx);
    expect(failing(6, 'The valves between the atria and ventricles are called the mitral valves')).toMatchObject({
      resolves: false,
      reason: 'not-found',
      checkId: 'quote-not-found',
    });
    expect(failing(6, 'the heart')).toMatchObject({ resolves: false, reason: 'too-short', checkId: 'quote-too-short' });
    expect(failing(99, quote)).toMatchObject({ resolves: false, reason: 'unknown-paragraph', checkId: 'unknown-paragraph/chunk', paragraphCount: 9 });
    expect(failing(2, quote)).toMatchObject({ resolves: false, reason: 'not-found' });
    const result = failing(6, 'nope nope nope nope nope nope');
    expect(String(result['fix']).length).toBeGreaterThan(10);
    expect(String(result['problem']).length).toBeGreaterThan(10);
  });

  it('flags an ambiguous quote when the words appear twice in the paragraph', () => {
    const ctx = newContext();
    const text = 'The cat sat on the warm mat by the door. Later, the cat sat on the warm mat by the window.';
    const { notesId } = run('prepare_notes', { text }, ctx) as { notesId: string };
    expect(run('resolve_quote', { notesId, paragraph: 1, quote: 'cat sat on the warm mat by the' }, ctx)).toMatchObject({
      resolves: false,
      reason: 'ambiguous',
      count: 2,
      checkId: 'quote-ambiguous',
    });
  });

  it('matches case exactly, as the app does', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    expect(run('resolve_quote', { notesId, paragraph: 6, quote: quote.toLowerCase() }, ctx)['resolves']).toBe(false);
  });

  it('allows a quote that resolves but is over 25 words, and reports it as too long', () => {
    const ctx = newContext();
    const prepared = prepareHeart(ctx);
    const paragraph = list(prepared.value['paragraphs'])[2]?.['text'];
    const out = run('resolve_quote', { notesId: prepared.notesId, paragraph: 3, quote: String(paragraph) }, ctx);
    expect(out).toMatchObject({ resolves: true, lengthOk: false, checkId: 'quote-too-long' });
  });

  it('refuses an unknown notesId with advice to prepare the notes again', () => {
    const outcome = callTool('resolve_quote', { notesId: 'notes_000000000000', paragraph: 1, quote }, newContext());
    expect(outcome).toMatchObject({ ok: false, error: { code: 'unknown-notes' } });
    expect(JSON.stringify(outcome)).toContain('prepare_notes');
  });

  it('refuses bad arguments', () => {
    const ctx = newContext();
    const { notesId } = prepareHeart(ctx);
    for (const args of [{ notesId, paragraph: 0, quote }, { notesId, paragraph: 1.5, quote }, { notesId, paragraph: '1', quote }, { notesId, paragraph: 1 }]) {
      expect(callTool('resolve_quote', args, ctx)).toMatchObject({ ok: false, error: { code: 'invalid-argument' } });
    }
  });
});

describe('normalise_text', () => {
  it('folds curly quotes, ligatures, line-break hyphens and whitespace', () => {
    const out = run('normalise_text', { text: 'The \u201Cof\uFB01ce\u201D is exam-\nple   text.' }, newContext());
    expect(out).toEqual({ normalised: 'The "office" is example text.', changed: true });
  });

  it('reports unchanged text as unchanged and keeps in-word hyphens', () => {
    expect(run('normalise_text', { text: 'a well-known fact' }, newContext())).toEqual({ normalised: 'a well-known fact', changed: false });
  });
});
