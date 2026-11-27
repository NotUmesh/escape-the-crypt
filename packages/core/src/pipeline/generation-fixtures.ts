import { makeMockLedger } from '../budget/mock-ledger';
import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import type { GenerationOptions } from './generation';
import type { ExtractedConcept } from './concept-extraction';
import { prepareDocument, type PreparedDocument } from './prepare-input';

const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
export const HEART = fs.readFileSync(`${here}/../../../../samples/human-heart.txt`, 'utf8');

export const OPTIONS: GenerationOptions = {
  modelId: 'test-model',
  temperature: 0,
  maxOutputTokens: 1000,
  timeoutMs: 5000,
  retryLimit: 0,
  worstCaseUsd: 0.01,
  costOf: () => 0.001,
};
export const USAGE = { inputTokens: 10, outputTokens: 5 };

export const heart: PreparedDocument = prepareDocument(HEART);

export function chunkIdContaining(doc: PreparedDocument, text: string): string {
  for (const chunk of doc.quotableChunksByOrdinal.values()) {
    if (chunk.text.includes(text)) return chunk.id;
  }
  throw new Error(`no chunk contains: ${text}`);
}

export const VALVES = 'The valves between the atria and ventricles';
export const valvesId = chunkIdContaining(heart, VALVES);
export const RUNE_QUOTE =
  'The valves between the atria and ventricles are called the atrioventricular valves, or AV valves';
export const MITRAL_QUOTE = 'the tricuspid valve on the right and the mitral valve on the left';

export const concept: ExtractedConcept = {
  conceptId: 'concept-1',
  label: 'Heart valves',
  chunkIds: [valvesId],
  quotes: [RUNE_QUOTE],
};

/** hh-q01, with `chunkId` where the authoring format has `paragraph`. */
export function rune(chunkId = valvesId) {
  return {
    lockType: 'rune-cipher' as const,
    prompt:
      'According to your notes, the valves between the atria and ventricles are called the ______ valves.',
    answer: 'atrioventricular',
    aliases: ['AV'],
    caseSensitive: false,
    evidence: [{ chunkId, quote: RUNE_QUOTE }],
    explanation: 'Your notes call them the atrioventricular (AV) valves.',
    hint: { kind: 'first-letter-and-length' as const, firstLetter: 'a', length: 16 },
  };
}

/** hh-q02. */
export function seance(chunkId = valvesId) {
  const ev = (quote: string) => ({ chunkId, quote });
  return {
    lockType: 'seance-board' as const,
    prompt: 'According to your notes, which atrioventricular valve is on the left side of the heart?',
    options: [
      { id: 'a', text: 'The tricuspid valve', label: 'contradicted' as const, evidence: ev(MITRAL_QUOTE) },
      { id: 'b', text: 'The mitral valve', label: 'supported' as const, evidence: ev(MITRAL_QUOTE) },
      {
        id: 'c',
        text: 'The aortic valve',
        label: 'contradicted' as const,
        evidence: ev('The pulmonary valve and the aortic valve sit where blood leaves the ventricles.'),
      },
    ],
    answer: 'b',
    explanation: 'The mitral valve is the AV valve on the left.',
  };
}

export function response(primary: unknown, alternate: unknown) {
  return { justification: 'fits', primary, alternate };
}

export function recordingProvider(
  results: readonly ProviderResult[],
): Provider & { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      return results[Math.min(requests.length - 1, results.length - 1)]!;
    },
  };
}

export const ok = (json: unknown): ProviderResult => ({ ok: true, json, usage: USAGE });
export const ledger = () => makeMockLedger({ dailyCapUsd: 1 });
