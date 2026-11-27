import {
  CHECK_REGISTRY,
  CHECK_VERSION,
  MAX_QUOTE_WORDS,
  MIN_QUOTE_CHARS,
  MIN_QUOTE_WORDS,
  parseAuthoringQuestion,
  runChecks,
  runRoomChecks,
  toEvidenceContext,
} from './core-imports';
import type { AuthoringQuestion, CheckFailure } from './core-imports';
import { advisoryCheckIds, hintFor } from './check-hints';
import { unknownNotes } from './tool-notes';
import { fail, ok, stringArg } from './tool-types';
import type { ToolContext, ToolOutcome } from './tool-types';

type Args = Readonly<Record<string, unknown>>;

export const SUPPORTED_LOCK_TYPES = [
  'rune-cipher',
  'seance-board',
  'bone-ordering',
  'bound-threads',
  'cursed-object',
  'combination-dial',
] as const;
export const MAX_QUIZ_QUESTIONS = 40;

const FORMATS_POINTER =
  `Supported lock types: ${SUPPORTED_LOCK_TYPES.join(', ')}. See references/question-formats.md for the exact shape of each.`;

interface Finding {
  readonly checkId: string;
  readonly problem: string;
  readonly fix: string;
}

function toFinding(failure: CheckFailure): Finding {
  return { checkId: failure.checkId, ...hintFor(failure.checkId) };
}

function resultFor(question: AuthoringQuestion, failures: readonly CheckFailure[]) {
  const advisory = advisoryCheckIds();
  const mine = failures.filter((f) => f.questionId === question.id);
  const blocking = mine.filter((f) => !advisory.has(f.checkId)).map(toFinding);
  return {
    questionId: question.id,
    lockType: question.lockType,
    passes: blocking.length === 0,
    blocking,
    advisory: mine.filter((f) => advisory.has(f.checkId)).map(toFinding),
  };
}

/** check_question: run the evidence code checks on one question. */
export function checkQuestion(args: Args, ctx: ToolContext): ToolOutcome {
  const id = stringArg(args, 'notesId', 100);
  if ('error' in id) return id.error;
  const notes = ctx.store.get(id.value);
  if (notes === undefined) return unknownNotes();
  const parsed = parseAuthoringQuestion(args['question']);
  if (!parsed.ok) {
    return ok({ valid: false, schemaProblemAt: parsed.error.path === '' ? '(the question itself)' : parsed.error.path, hint: FORMATS_POINTER });
  }
  const question = parsed.value;
  const failures = runChecks({ question, ...toEvidenceContext(notes.prepared) });
  return ok({
    valid: true,
    ...resultFor(question, failures),
    checkVersion: CHECK_VERSION,
    notChecked: [
      'Whether the question is a good one, or whether the answer is the only reasonable answer.',
      'The blind model review: a second reader answering without the key.',
      ...(question.role === 'alternate' ? ['Alternate checks (they need the primary): use check_quiz.'] : []),
    ],
  });
}

/** check_quiz: run every check on a set of questions, including the checks that compare questions (leaks, duplicate answers, alternates). */
export function checkQuiz(args: Args, ctx: ToolContext): ToolOutcome {
  const id = stringArg(args, 'notesId', 100);
  if ('error' in id) return id.error;
  const notes = ctx.store.get(id.value);
  if (notes === undefined) return unknownNotes();
  const raw = args['questions'];
  if (!Array.isArray(raw) || raw.length === 0) return fail('invalid-argument', '"questions" must be a non-empty array.');
  if (raw.length > MAX_QUIZ_QUESTIONS) return fail('invalid-argument', `"questions" has more than ${MAX_QUIZ_QUESTIONS} items.`);

  const questions: AuthoringQuestion[] = [];
  const invalid: { index: number; schemaProblemAt: string }[] = [];
  raw.forEach((item: unknown, index) => {
    const parsed = parseAuthoringQuestion(item);
    if (parsed.ok) questions.push(parsed.value);
    else invalid.push({ index, schemaProblemAt: parsed.error.path === '' ? '(the question itself)' : parsed.error.path });
  });
  const ids = questions.map((q) => q.id);
  if (new Set(ids).size !== ids.length) return fail('duplicate-question-id', 'Every question needs its own id.');

  const failures = runRoomChecks(questions, toEvidenceContext(notes.prepared));
  const results = questions.map((q) => resultFor(q, failures));
  const byCheckId: Record<string, number> = {};
  for (const r of results) for (const f of r.blocking) byCheckId[f.checkId] = (byCheckId[f.checkId] ?? 0) + 1;
  return ok({
    passes: invalid.length === 0 && results.every((r) => r.passes),
    summary: {
      total: raw.length,
      passing: results.filter((r) => r.passes).length,
      failing: results.filter((r) => !r.passes).length,
      invalid: invalid.length,
      blockingByCheckId: byCheckId,
    },
    invalid: invalid.length === 0 ? [] : invalid.map((i) => ({ ...i, hint: FORMATS_POINTER })),
    questions: results,
    checkVersion: CHECK_VERSION,
    notChecked: [
      'Whether each question is a good one.',
      'The blind model review: a second reader answering without the key.',
    ],
  });
}

/** list_checks: every check this Power can report, with the help text it gives. */
export function listChecks(): ToolOutcome {
  const checks = CHECK_REGISTRY.filter((r) => r.implemented).map((r) => ({
    id: r.id,
    appliesTo: r.scope === 'shared' ? 'every supported lock type' : r.scope,
    severity: r.severity,
    ...hintFor(r.id),
  }));
  return ok({
    checkVersion: CHECK_VERSION,
    supportedLockTypes: SUPPORTED_LOCK_TYPES,
    quoteRules: { minWords: MIN_QUOTE_WORDS, minChars: MIN_QUOTE_CHARS, maxWords: MAX_QUOTE_WORDS },
    checks,
  });
}
