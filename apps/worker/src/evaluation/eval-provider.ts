import type { Provider } from '@escape-the-crypt/core';
import { PROVIDER_NAMES, type ProviderName } from '../config';
import { isGeminiModelId, makeGeminiProvider } from '../provider/gemini-provider';
import { makeOpenAiProvider } from '../provider/openai-provider';

/** Test seam: production never passes it. A fake live provider replaces the real one, so tests make no call. */
export interface EvalOverrides {
  readonly live?: Provider;
}

const KEY_NAME: Readonly<Record<ProviderName, string>> = { openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };

export type EvalProviderError =
  | { readonly kind: 'invalid-provider'; readonly value: string }
  | { readonly kind: 'invalid-model-id' };

/** Parses `--provider` (absent means openai) and checks `--model` is usable for it. */
export function parseEvalProvider(
  raw: string | undefined,
  modelId: string,
): { readonly ok: true; readonly value: ProviderName } | { readonly ok: false; readonly error: EvalProviderError } {
  const name = raw ?? 'openai';
  const known = PROVIDER_NAMES.find((p) => p === name);
  if (known === undefined) return { ok: false, error: { kind: 'invalid-provider', value: name } };
  // A Gemini model ID names the cassette folder and goes into the request URL.
  if (known === 'gemini' && !isGeminiModelId(modelId)) return { ok: false, error: { kind: 'invalid-model-id' } };
  return { ok: true, value: known };
}

export function evalProviderErrorText(error: EvalProviderError): string {
  return error.kind === 'invalid-provider'
    ? `Unknown provider "${error.value}"; use openai or gemini. Nothing was called.`
    : 'For --provider gemini, --model must be a bare model ID such as gemini-3.8-flash. Nothing was called.';
}

/** The live provider for `record`, with its key read from this shell's environment only. */
export function liveEvalProvider(
  name: ProviderName,
  env: Readonly<Record<string, string | undefined>>,
  overrides: EvalOverrides = {},
): { readonly ok: true; readonly value: Provider } | { readonly ok: false; readonly message: string } {
  if (overrides.live !== undefined) return { ok: true, value: overrides.live };
  const key = env[KEY_NAME[name]]?.trim();
  if (key === undefined || key.length === 0) return { ok: false, message: `${KEY_NAME[name]} is not set in this shell. Nothing was called.` };
  return { ok: true, value: name === 'gemini' ? makeGeminiProvider({ apiKey: key }) : makeOpenAiProvider({ apiKey: key }) };
}
