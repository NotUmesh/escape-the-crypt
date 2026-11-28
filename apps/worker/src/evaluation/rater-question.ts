import { z } from '@escape-the-crypt/core';

/**
 * What a rater sees of one generated question. Parsed from a recorded generation reply with a
 * local, lenient schema (extra fields are ignored): core's generation schema is not exported and
 * this tooling must not widen core. It only reads; nothing here validates a question for play.
 */
const Evidence = z.object({ chunkId: z.string(), quote: z.string() });
const Base = { prompt: z.string(), explanation: z.string() };

const Arm = z.discriminatedUnion('lockType', [
  z.object({ lockType: z.literal('rune-cipher'), ...Base, answer: z.string(), aliases: z.array(z.string()), evidence: z.array(Evidence) }),
  z.object({
    lockType: z.literal('seance-board'),
    ...Base,
    options: z.array(z.object({ id: z.string(), text: z.string(), label: z.string(), evidence: Evidence })),
    answer: z.string(),
  }),
  z.object({ lockType: z.literal('bone-ordering'), ...Base, steps: z.array(z.string()), evidence: z.array(Evidence) }),
  z.object({
    lockType: z.literal('bound-threads'),
    ...Base,
    pairs: z.array(z.object({ left: z.string(), right: z.string(), evidence: Evidence })),
  }),
  z.object({
    lockType: z.literal('cursed-object'),
    ...Base,
    items: z.array(z.string()),
    answer: z.string(),
    categoryRule: z.string(),
    evidence: z.array(Evidence),
  }),
  z.object({
    lockType: z.literal('combination-dial'),
    ...Base,
    answer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('exact'), value: z.number() }),
      z.object({ kind: z.literal('range'), min: z.number(), max: z.number() }),
      z.object({ kind: z.literal('template'), template: z.string(), inputs: z.array(z.number()), value: z.number() }),
    ]),
    units: z.string(),
    evidence: z.array(Evidence),
  }),
]);

const Reply = z.object({ justification: z.string(), primary: Arm.nullable(), alternate: Arm.nullable() });
type ParsedArm = z.infer<typeof Arm>;

export interface RaterQuestion {
  readonly lockType: string;
  readonly prompt: string;
  /** The key a rater checks the question against, as readable text. */
  readonly answer: string;
  /** Options or items, as readable text; empty when the type has none. */
  readonly options: string;
  /** The cited quotes, joined; each prefixed with what it supports. */
  readonly quotes: string;
  readonly explanation: string;
}

const SEP = ' | ';

function describe(q: ParsedArm): Omit<RaterQuestion, 'lockType' | 'prompt' | 'explanation'> {
  switch (q.lockType) {
    case 'rune-cipher':
      return { answer: [q.answer, ...q.aliases].join(' / '), options: '', quotes: q.evidence.map((e) => e.quote).join(SEP) };
    case 'seance-board': {
      const key = q.options.find((o) => o.id === q.answer);
      return {
        answer: key === undefined ? q.answer : `${key.id}: ${key.text}`,
        options: q.options.map((o) => `${o.id}: ${o.text} (${o.label})`).join(SEP),
        quotes: q.options.map((o) => `[${o.id}] ${o.evidence.quote}`).join(SEP),
      };
    }
    case 'bone-ordering':
      return { answer: q.steps.join(' → '), options: '', quotes: q.evidence.map((e) => e.quote).join(SEP) };
    case 'bound-threads':
      return {
        answer: q.pairs.map((p) => `${p.left} ↔ ${p.right}`).join('; '),
        options: '',
        quotes: q.pairs.map((p, i) => `[${i + 1}] ${p.evidence.quote}`).join(SEP),
      };
    case 'cursed-object':
      return { answer: `${q.answer} (rule: ${q.categoryRule})`, options: q.items.join(SEP), quotes: q.evidence.map((e) => e.quote).join(SEP) };
    case 'combination-dial': {
      const a = q.answer;
      const value = a.kind === 'exact' ? String(a.value) : a.kind === 'range' ? `${a.min} to ${a.max}` : `${a.template}(${a.inputs.join(', ')}) = ${a.value}`;
      return { answer: q.units === '' ? value : `${value} ${q.units}`, options: '', quotes: q.evidence.map((e) => e.quote).join(SEP) };
    }
  }
}

function toRater(q: ParsedArm | null): RaterQuestion | null {
  return q === null ? null : { lockType: q.lockType, prompt: q.prompt, explanation: q.explanation, ...describe(q) };
}

/** A recorded generation reply as rater text. Null when the JSON is not a generation reply. */
export function parseGenerationReply(json: unknown): { readonly primary: RaterQuestion | null; readonly alternate: RaterQuestion | null } | null {
  const parsed = Reply.safeParse(json);
  return parsed.success ? { primary: toRater(parsed.data.primary), alternate: toRater(parsed.data.alternate) } : null;
}
