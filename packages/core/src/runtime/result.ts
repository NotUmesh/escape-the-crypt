import type { RuntimeErrorKind, Typed_Rejection } from '../types';
import type { Outcome_Notice } from './notices';
import type { State } from './state-types';

export type ApplyResult =
  | { readonly ok: true; readonly state: State; readonly notices: readonly Outcome_Notice[] }
  | { readonly ok: false; readonly error: Typed_Rejection };

export function accept(state: State, notices: readonly Outcome_Notice[] = []): ApplyResult {
  return { ok: true, state, notices };
}

/** Build a typed rejection. `extra` carries diagnostics only, never user content. */
export function reject(
  kind: RuntimeErrorKind,
  extra: Readonly<Record<string, unknown>> = {},
): ApplyResult {
  return { ok: false, error: { ...extra, kind } };
}
