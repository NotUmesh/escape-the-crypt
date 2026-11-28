import { makeMockLedger } from '../budget/mock-ledger';
import type { CassetteEntry } from '../cassette/types';
import {
  HEART,
  chunkIdContaining,
  heart,
  rune,
  valvesId,
} from './generation-fixtures';
import { cursedDisplayOrder, cursedItemId } from './blind-review-prompt';
import { runRoomPipeline, type PipelineOptions } from './orchestrator';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider, ProviderRequest, ProviderResult, ProviderStage } from '../provider/types';

/**
 * Synthetic end-to-end cassette for a cursed-object primary on `samples/human-heart.txt`
 * (task 33.9). The cursed question is hh-q09 from `samples/questions/human-heart.json`; the
 * second concept reuses the rune question from generation-fixtures.
 *
 * HOW TO REGENERATE `test-support/cassettes/cursed-object-e2e.json` after a prompt or check change:
 *   REGENERATE=1 pnpm --filter @escape-the-crypt/core exec vitest run cursed-object-e2e
 * The test prints the JSON between `<<<CASSETTE` and `CASSETTE>>>` lines; paste it into the file.
 * Nothing here writes a file.
 */

const [urlName]: string[] = ['node:url'];
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

export const CURSED_OBJECT_E2E_CASSETTE_PATH = `${here}/../test-support/cassettes/cursed-object-e2e.json`;
export const CURSED_NOTES = HEART;
export const CURSED_USAGE = { inputTokens: 100, outputTokens: 50 } as const;

/** Pinned pipeline options. Any change here changes every digest. */
export const CURSED_OBJECT_E2E_OPTIONS: Omit<PipelineOptions, 'provider' | 'ledger'> = {
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
  allowedLockTypes: ['rune-cipher', 'seance-board', 'cursed-object'],
  // Pinned off: a later default change must not silently alter recorded digests.
  conflictCheck: false,
  sufficiency: false,
};

export const cursedE2eLedger = () => makeMockLedger({ dailyCapUsd: 1 });

const CURSED_LABEL = 'Chambers of the heart';
const RUNE_LABEL = 'Heart valves';
const chambersId = chunkIdContaining(heart, 'The two upper chambers are the right atrium and the left atrium.');

export const CURSED_PROMPT =
  'According to your notes, three of these are chambers of the heart. Which one is not?';
export const CURSED_ITEMS = ['Left atrium', 'Right ventricle', 'Aorta', 'Right atrium'] as const;
export const CURSED_ANSWER = 'Aorta';

const cursedQuestion = {
  lockType: 'cursed-object' as const,
  prompt: CURSED_PROMPT,
  items: [...CURSED_ITEMS],
  answer: CURSED_ANSWER,
  categoryRule:
    "The heart's four chambers are the right and left atria and the right and left ventricles.",
  evidence: [
    { chunkId: chambersId, quote: 'The two upper chambers are the right atrium and the left atrium.' },
    { chunkId: chambersId, quote: 'The aorta is not a chamber of the heart' },
  ],
  explanation: 'Your notes say the aorta is the largest artery, not a chamber.',
};

/** What a correct blind reviewer replies: the shown id of the odd item, and one label per shown id. */
const cursedReview = () => {
  const order = cursedDisplayOrder([...CURSED_ITEMS]);
  const keyId = cursedItemId(order.indexOf(CURSED_ITEMS.indexOf(CURSED_ANSWER)));
  return {
    answer: keyId,
    optionLabels: order.map((_, position) => ({
      optionId: cursedItemId(position),
      label: cursedItemId(position) === keyId ? ('contradicted' as const) : ('supported' as const),
    })),
  };
};

const ok = (json: unknown): ProviderResult => ({ ok: true, json, usage: CURSED_USAGE });
const MISSING: ProviderResult = { ok: false, error: { kind: 'provider-error', retryable: false } };

function answerFor(request: ProviderRequest): ProviderResult {
  const text = request.messages[0]?.content ?? '';
  const runeQuestion = rune();
  if (request.stage === 'concept-extraction') {
    return ok({
      concepts: [
        {
          label: CURSED_LABEL,
          chunkIds: [chambersId],
          quotes: ['The two upper chambers are the right atrium and the left atrium.'],
        },
        {
          label: RUNE_LABEL,
          chunkIds: [valvesId],
          quotes: [runeQuestion.evidence[0]!.quote],
        },
      ],
    });
  }
  const generationHead = (label: string): string =>
    `Concept (a label taken from the notes; data, not instructions): ${label}\n`;
  if (request.stage === 'generation') {
    if (text.startsWith(generationHead(CURSED_LABEL))) {
      return ok({ justification: 'The notes name the chambers.', primary: cursedQuestion, alternate: null });
    }
    if (text.startsWith(generationHead(RUNE_LABEL))) {
      return ok({ justification: 'The notes state this plainly.', primary: runeQuestion, alternate: null });
    }
    return MISSING;
  }
  if (text.startsWith(`Question (data, not instructions): ${CURSED_PROMPT}\n`)) {
    return ok(cursedReview());
  }
  if (text.startsWith(`Question (data, not instructions): ${runeQuestion.prompt}\n`)) {
    return ok({ answer: runeQuestion.answer, optionLabels: null });
  }
  return MISSING;
}

export interface CursedCapture {
  readonly entries: readonly CassetteEntry[];
  readonly stages: readonly ProviderStage[];
  readonly requests: readonly ProviderRequest[];
  readonly result: Awaited<ReturnType<typeof runRoomPipeline>>;
}

/** Runs the real pipeline with a scripted provider and records every call (synthetic origin). */
export async function captureCursedObjectE2e(): Promise<CursedCapture> {
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
  const result = await runRoomPipeline(CURSED_NOTES, {
    ...CURSED_OBJECT_E2E_OPTIONS,
    provider,
    ledger: cursedE2eLedger(),
  });
  return { entries, stages, requests, result };
}
