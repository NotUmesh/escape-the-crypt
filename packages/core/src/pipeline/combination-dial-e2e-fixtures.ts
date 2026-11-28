import { makeMockLedger } from '../budget/mock-ledger';
import type { CassetteEntry } from '../cassette/types';
import { HEART, chunkIdContaining, heart, rune, valvesId } from './generation-fixtures';
import { runRoomPipeline, type PipelineOptions } from './orchestrator';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider, ProviderRequest, ProviderResult, ProviderStage } from '../provider/types';

/**
 * Synthetic end-to-end cassette for combination-dial primaries on `samples/human-heart.txt`
 * (task 35.8). ONE pipeline run with three concepts, in this order:
 *   1. an `exact` dial (hh-q10, four chambers)          -> takes the room's dial slot
 *   2. a `template` dial (`difference` of 100 and 60)    -> accepted, but room assembly keeps at
 *      most one dial per room, so it lands in `unplacedAccepted`
 *   3. the rune question from generation-fixtures        -> takes the second slot
 * One run is used because the concept-extraction request is identical for the same notes, so two
 * runs could not share one digest-keyed cassette with different extraction replies.
 *
 * HOW TO REGENERATE `test-support/cassettes/combination-dial-e2e.json` after a prompt or check change:
 *   REGENERATE=1 pnpm --filter @escape-the-crypt/core exec vitest run combination-dial-e2e
 * The test prints the JSON between `<<<CASSETTE` and `CASSETTE>>>` lines; paste it into the file.
 * Nothing here writes a file.
 */

const [urlName]: string[] = ['node:url'];
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

export const COMBINATION_DIAL_E2E_CASSETTE_PATH = `${here}/../test-support/cassettes/combination-dial-e2e.json`;
export const DIAL_NOTES = HEART;
export const DIAL_USAGE = { inputTokens: 100, outputTokens: 50 } as const;

/** Pinned pipeline options. Any change here changes every digest. */
export const COMBINATION_DIAL_E2E_OPTIONS: Omit<PipelineOptions, 'provider' | 'ledger'> = {
  modelId: 'synthetic-e2e',
  temperature: 0,
  maxOutputTokens: 2000,
  timeoutMs: 30000,
  retryLimit: 0,
  worstCaseUsd: 0.01,
  costOf: () => 0.001,
  providerName: 'synthetic',
  concurrency: 1,
  // Pinned explicitly: the recorded digests depend on this list, so it must not follow the shared constant.
  allowedLockTypes: ['rune-cipher', 'seance-board', 'combination-dial'],
  // Pinned off: a later default change must not silently alter recorded digests.
  conflictCheck: false,
  sufficiency: false,
};

export const dialE2eLedger = () => makeMockLedger({ dailyCapUsd: 1 });

const CHAMBERS_QUOTE = 'The heart has four chambers.';
const RATE_QUOTE = 'a normal heart rate is between 60 and 100 beats per minute';
const chambersId = chunkIdContaining(heart, CHAMBERS_QUOTE);
const rateId = chunkIdContaining(heart, RATE_QUOTE);

export const EXACT_LABEL = 'Number of heart chambers';
export const TEMPLATE_LABEL = 'Resting heart rate';
const RUNE_LABEL = 'Heart valves';

export const EXACT_PROMPT = 'According to your notes, how many chambers does the human heart have?';
export const TEMPLATE_PROMPT =
  'According to your notes, how many beats per minute higher is the top of a normal resting heart rate than the bottom?';

const exactQuestion = {
  lockType: 'combination-dial' as const,
  prompt: EXACT_PROMPT,
  answer: { kind: 'exact' as const, value: 4 },
  units: 'chambers',
  evidence: [{ chunkId: chambersId, quote: CHAMBERS_QUOTE }],
  explanation: 'Your notes say four.',
};

const templateQuestion = {
  lockType: 'combination-dial' as const,
  prompt: TEMPLATE_PROMPT,
  // The model's `value` is only a claim; code recomputes the difference from the inputs.
  answer: { kind: 'template' as const, template: 'difference' as const, inputs: [100, 60], value: 40 },
  units: 'beats per minute',
  evidence: [{ chunkId: rateId, quote: RATE_QUOTE }],
  explanation: 'Your notes give 60 and 100, and 100 minus 60 is 40.',
};

const ok = (json: unknown): ProviderResult => ({ ok: true, json, usage: DIAL_USAGE });
const MISSING: ProviderResult = { ok: false, error: { kind: 'provider-error', retryable: false } };

function answerFor(request: ProviderRequest): ProviderResult {
  const text = request.messages[0]?.content ?? '';
  const runeQuestion = rune();
  if (request.stage === 'concept-extraction') {
    return ok({
      concepts: [
        { label: EXACT_LABEL, chunkIds: [chambersId], quotes: [CHAMBERS_QUOTE] },
        { label: TEMPLATE_LABEL, chunkIds: [rateId], quotes: [RATE_QUOTE] },
        { label: RUNE_LABEL, chunkIds: [valvesId], quotes: [runeQuestion.evidence[0]!.quote] },
      ],
    });
  }
  const generationHead = (label: string): string =>
    `Concept (a label taken from the notes; data, not instructions): ${label}\n`;
  if (request.stage === 'generation') {
    if (text.startsWith(generationHead(EXACT_LABEL))) {
      return ok({ justification: 'The notes state the number.', primary: exactQuestion, alternate: null });
    }
    if (text.startsWith(generationHead(TEMPLATE_LABEL))) {
      return ok({ justification: 'The notes state both bounds.', primary: templateQuestion, alternate: null });
    }
    if (text.startsWith(generationHead(RUNE_LABEL))) {
      return ok({ justification: 'The notes state this plainly.', primary: runeQuestion, alternate: null });
    }
    return MISSING;
  }
  // The dial reviewer gives one number; code compares it with the key (blind-review-dial.ts).
  const review = (prompt: string): boolean => text.startsWith(`Question (data, not instructions): ${prompt}\n`);
  if (review(EXACT_PROMPT)) return ok({ answer: '4', optionLabels: null });
  if (review(TEMPLATE_PROMPT)) return ok({ answer: '40', optionLabels: null });
  if (review(runeQuestion.prompt)) return ok({ answer: runeQuestion.answer, optionLabels: null });
  return MISSING;
}

export interface DialCapture {
  readonly entries: readonly CassetteEntry[];
  readonly stages: readonly ProviderStage[];
  readonly requests: readonly ProviderRequest[];
  readonly result: Awaited<ReturnType<typeof runRoomPipeline>>;
}

/** Runs the real pipeline with a scripted provider and records every call (synthetic origin). */
export async function captureDialE2e(): Promise<DialCapture> {
  const entries: CassetteEntry[] = [];
  const stages: ProviderStage[] = [];
  const requests: ProviderRequest[] = [];
  const provider: Provider = {
    async complete(request) {
      const response = answerFor(request);
      stages.push(request.stage);
      requests.push(request);
      if (response.ok) entries.push({ digest: promptDigest(request), origin: 'synthetic', response });
      return response;
    },
  };
  const result = await runRoomPipeline(DIAL_NOTES, {
    ...COMBINATION_DIAL_E2E_OPTIONS,
    provider,
    ledger: dialE2eLedger(),
  });
  return { entries, stages, requests, result };
}
