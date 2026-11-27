import { checkQuestion, checkQuiz, listChecks } from './tool-checks';
import { TOOL_DEFINITIONS } from './tool-definitions';
import { normaliseTextTool, prepareNotes, resolveQuoteTool } from './tool-notes';
import { fail } from './tool-types';
import type { ToolContext, ToolOutcome } from './tool-types';

export { TOOL_DEFINITIONS };

/** Runs one tool by name. Never throws: a bug inside a tool becomes a typed refusal with no content in it. */
export function callTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) {
    return fail('invalid-argument', 'Tool arguments must be an object.');
  }
  const args = rawArgs as Readonly<Record<string, unknown>>;
  try {
    switch (name) {
      case 'prepare_notes':
        return prepareNotes(args, ctx);
      case 'resolve_quote':
        return resolveQuoteTool(args, ctx);
      case 'check_question':
        return checkQuestion(args, ctx);
      case 'check_quiz':
        return checkQuiz(args, ctx);
      case 'normalise_text':
        return normaliseTextTool(args);
      case 'list_checks':
        return listChecks();
      default:
        return fail('unknown-tool', `There is no tool named "${name}".`);
    }
  } catch {
    return fail('internal-error', 'The tool failed unexpectedly. Nothing was kept.');
  }
}
