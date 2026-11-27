import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from './parse';

const dirs = ['eval/dev/questions', 'samples/questions'];

// packages/core compiles without Node types, so load Node modules dynamically.
async function realQuestions(): Promise<{ file: string; q: Record<string, unknown> }[]> {
  const fsSpecifier: string = 'node:fs';
  const urlSpecifier: string = 'node:url';
  const fs = (await import(fsSpecifier)) as unknown as {
    readdirSync(path: string): string[];
    readFileSync(path: string, enc: string): string;
  };
  const url = (await import(urlSpecifier)) as unknown as { fileURLToPath(href: string): string };
  const href = (import.meta as unknown as { url: string }).url;
  const here = url.fileURLToPath(href).replace(/\\/g, '/').replace(/\/[^/]*$/, '');
  const root = `${here}/../../../..`;
  const out: { file: string; q: Record<string, unknown> }[] = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(`${root}/${d}`)) {
      const json = JSON.parse(fs.readFileSync(`${root}/${d}/${f}`, 'utf8')) as {
        questions: Record<string, unknown>[];
      };
      for (const q of json.questions) out.push({ file: `${d}/${f}`, q });
    }
  }
  return out;
}

const rune = {
  id: 'q1',
  conceptId: 'c1',
  role: 'primary',
  lockType: 'rune-cipher',
  prompt: 'The ___ pumps blood.',
  answer: 'heart',
  aliases: [],
  caseSensitive: false,
  evidence: [{ paragraph: 1, quote: 'The heart pumps blood.' }],
  explanation: 'x',
};

const seance = {
  id: 'q2',
  conceptId: 'c1',
  role: 'primary',
  lockType: 'seance-board',
  prompt: 'According to your notes, what pumps blood?',
  options: ['a', 'b', 'c'].map((id, i) => ({
    id,
    text: `opt ${id}`,
    label: i === 0 ? 'supported' : 'contradicted',
    evidence: { paragraph: 1, quote: 'q' },
  })),
  answer: 'a',
  explanation: 'x',
};

describe('parseAuthoringQuestion', () => {
  it('parses every real rune cipher and séance board question', async () => {
    const relevant = (await realQuestions()).filter(({ q }) => q.lockType === 'rune-cipher' || q.lockType === 'seance-board');
    expect(relevant.length).toBeGreaterThan(0);
    for (const { file, q } of relevant) {
      const r = parseAuthoringQuestion(q);
      expect(r.ok, `${file} ${String(q.id)}`).toBe(true);
    }
  });

  it('parses every real bone-ordering dev and sample question, and rejects bad shapes', async () => {
    const bones = (await realQuestions()).filter(({ q }) => q.lockType === 'bone-ordering');
    expect(bones.length).toBeGreaterThan(0);
    for (const { file, q } of bones) {
      expect(parseAuthoringQuestion(q).ok, `${file} ${String(q.id)}`).toBe(true);
    }
    const base = bones[0]!.q;
    const path = (v: unknown) => {
      const r = parseAuthoringQuestion(v);
      return r.ok ? null : r.error.path;
    };
    expect(path({ ...base, steps: ['a', 'b'] })).toBe('steps');
    expect(path({ ...base, steps: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('steps');
    expect(path({ ...base, steps: ['a', '', 'c'] })).toBe('steps.1');
    expect(path({ ...base, offset: 1 })).toBe('offset');
    expect(path({ ...base, hint: { kind: 'lock-first-bone', boneId: 'x' } })).toBeNull();
  });

  it('parses every real rune cipher and séance board question (again, by directory)', async () => {
    const relevant = (await realQuestions()).filter(({ q }) => q.lockType === 'rune-cipher' || q.lockType === 'seance-board');
    for (const { file, q } of relevant) {
      const r = parseAuthoringQuestion(q);
      expect(r.ok, `${file} ${String(q.id)}`).toBe(true);
    }
  });

  it('rejects other lock types and unknown lock types without throwing', () => {
    expect(parseAuthoringQuestion({ ...rune, lockType: 'bone-ordering' }).ok).toBe(false); // rune fields on a bone arm
    expect(parseAuthoringQuestion({ ...rune, lockType: 'bound-threads' }).ok).toBe(false);
    const r = parseAuthoringQuestion({ ...rune, lockType: 'nope' });
    expect(r).toEqual({ ok: false, error: { kind: 'invalid-authoring-question', path: 'lockType' } });
  });

  it('reports the failing field path', () => {
    const r = parseAuthoringQuestion({ ...rune, answer: '' });
    expect(r).toEqual({ ok: false, error: { kind: 'invalid-authoring-question', path: 'answer' } });
    const s = parseAuthoringQuestion({
      ...seance,
      options: [{ ...seance.options[0], label: 'not-mentioned' }, seance.options[1], seance.options[2]],
    });
    expect(s).toEqual({ ok: false, error: { kind: 'invalid-authoring-question', path: 'options.0.label' } });
  });

  it('rejects offsets and a hint on séance board questions', () => {
    const withOffset = parseAuthoringQuestion({
      ...rune,
      evidence: [{ paragraph: 1, quote: 'q', start: 3 }],
    });
    expect(withOffset.ok).toBe(false);
    if (!withOffset.ok) expect(withOffset.error.path).toBe('evidence.0.start');
    const hint = parseAuthoringQuestion({ ...seance, hint: { kind: 'first-letter-and-length' } });
    expect(hint.ok).toBe(false);
  });

  it('parses real questions from both directories', async () => {
    const all = await realQuestions();
    for (const d of dirs) {
      const inDir = all.filter(({ file, q }) => file.startsWith(d) && (q.lockType === 'rune-cipher' || q.lockType === 'seance-board'));
      for (const { file, q } of inDir) expect(parseAuthoringQuestion(q).ok, `${file} ${String(q.id)}`).toBe(true);
    }
  });

  it('rejects an unknown offset key at the top level and inside evidence', () => {
    expect(parseAuthoringQuestion({ ...rune, offset: 4 })).toEqual({
      ok: false,
      error: { kind: 'invalid-authoring-question', path: 'offset' },
    });
    expect(parseAuthoringQuestion({ ...rune, evidence: [{ paragraph: 1, quote: 'q', offset: 4 }] })).toEqual({
      ok: false,
      error: { kind: 'invalid-authoring-question', path: 'evidence.0.offset' },
    });
    const opt = { ...seance.options[0], evidence: { paragraph: 1, quote: 'q', offset: 2 } };
    expect(parseAuthoringQuestion({ ...seance, options: [opt, seance.options[1], seance.options[2]] })).toEqual({
      ok: false,
      error: { kind: 'invalid-authoring-question', path: 'options.0.evidence.offset' },
    });
  });

  it('rejects empty rune answers and reports malformed field paths', () => {
    const path = (v: unknown) => {
      const r = parseAuthoringQuestion(v);
      return r.ok ? null : r.error.path;
    };
    expect(path({ ...rune, answer: '' })).toBe('answer');
    expect(path({ ...rune, evidence: [] })).toBe('evidence');
    expect(path({ ...rune, evidence: [{ paragraph: 0, quote: 'q' }] })).toBe('evidence.0.paragraph');
    expect(path({ ...rune, evidence: [{ paragraph: 1, quote: 5 }] })).toBe('evidence.0.quote');
    expect(path({ ...rune, role: 'other' })).toBe('role');
    expect(path({ ...rune, caseSensitive: 'no' })).toBe('caseSensitive');
    expect(path({ ...seance, options: seance.options.slice(0, 2) })).toBe('options');
    expect(path({ ...seance, prompt: '' })).toBe('prompt');
    expect(path({ ...rune, lockType: 'nope' })).toBe('lockType');
    expect(path(null)).toBe('');
  });

  it('never throws on arbitrary input', () => {
    fc.assert(fc.property(fc.anything(), (v) => typeof parseAuthoringQuestion(v).ok === 'boolean'));
  });

  it('round-trips through JSON with option order preserved', () => {
    const first = parseAuthoringQuestion(seance);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parseAuthoringQuestion(JSON.parse(JSON.stringify(first.value)));
    expect(second).toEqual(first);
  });
});
