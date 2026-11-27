import type { NotesStore } from './notes-store';

export interface ToolContext {
  readonly store: NotesStore;
}

/** A refusal the learner or the agent can act on. Carries no notes text and no question text. */
export interface ToolError {
  readonly code: string;
  readonly message: string;
}

export type ToolOutcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: ToolError };

export const ok = (value: unknown): ToolOutcome => ({ ok: true, value });
export const fail = (code: string, message: string): ToolOutcome => ({ ok: false, error: { code, message } });

type Args = Readonly<Record<string, unknown>>;

/** A required string argument, or a refusal that names it. */
export function stringArg(args: Args, name: string, maxChars: number): { value: string } | { error: ToolOutcome } {
  const value = args[name];
  if (typeof value !== 'string') return { error: fail('invalid-argument', `"${name}" must be a string.`) };
  if (value.length > maxChars) return { error: fail('invalid-argument', `"${name}" is longer than ${maxChars} characters.`) };
  return { value };
}

/** A required positive whole number argument. */
export function positiveIntArg(args: Args, name: string): { value: number } | { error: ToolOutcome } {
  const value = args[name];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { error: fail('invalid-argument', `"${name}" must be a whole number of 1 or more.`) };
  }
  return { value };
}
