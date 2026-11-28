import { describe, expect, it } from 'vitest';
import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { statedAnswerOf } from './answer-statement';

const dirs = ['eval/dev/questions', 'samples/questions'];

// packages/core compiles without Node types, so load Node modules dynamically.
async function realQuestions(): Promise<AuthoringQuestion[]> {
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
  const out: AuthoringQuestion[] = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(`${root}/${d}`)) {
      const json = JSON.parse(fs.readFileSync(`${root}/${d}/${f}`, 'utf8')) as { questions: unknown[] };
      for (const raw of json.questions) {
        const parsed = parseAuthoringQuestion(raw);
        if (parsed.ok) out.push(parsed.value);
      }
    }
  }
  return out;
}

describe('statedAnswerOf over the real dev and sample questions', () => {
  it('returns one non-empty line per question, covering all six lock types', async () => {
    const questions = await realQuestions();
    const seen = new Set<string>();
    for (const q of questions) {
      const line = statedAnswerOf(q);
      expect(line, q.id).not.toBe('');
      expect(line, q.id).not.toMatch(/[\r\n]/);
      seen.add(q.lockType);
    }
    expect([...seen].sort()).toEqual([
      'bone-ordering',
      'bound-threads',
      'combination-dial',
      'cursed-object',
      'rune-cipher',
      'seance-board',
    ]);
  });

  it('renders the key of each type as text', async () => {
    const questions = await realQuestions();
    for (const q of questions) {
      const line = statedAnswerOf(q);
      if (q.lockType === 'rune-cipher' || q.lockType === 'cursed-object') expect(line).toBe(q.answer.trim());
      if (q.lockType === 'seance-board') {
        expect(line).toBe(q.options.find((o) => o.id === q.answer)?.text.trim());
      }
      if (q.lockType === 'bone-ordering') {
        q.steps.forEach((s, i) => expect(line).toContain(`${i + 1}. ${s.trim()}`));
      }
      if (q.lockType === 'bound-threads') {
        for (const p of q.pairs) expect(line).toContain(`${p.left.trim()} = ${p.right.trim()}`);
      }
      if (q.lockType === 'combination-dial') {
        const a = q.answer;
        if (a.kind === 'range') expect(line).toContain(`${a.min} to ${a.max}`);
        else expect(line).toContain(String(a.value));
      }
    }
  });
});

describe('statedAnswerOf never throws', () => {
  it('returns an empty line for malformed input', () => {
    const bad: unknown[] = [null, undefined, 3, 'x', [], {}, { lockType: 'seance-board', options: 5 }, { lockType: 'combination-dial', answer: null }];
    for (const b of bad) expect(statedAnswerOf(b as AuthoringQuestion)).toBe('');
  });
});
