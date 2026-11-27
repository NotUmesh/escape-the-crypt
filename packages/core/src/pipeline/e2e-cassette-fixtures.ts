import { makeMockLedger } from '../budget/mock-ledger';
import type { CassetteEntry } from '../cassette/types';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider, ProviderRequest, ProviderResult, ProviderStage } from '../provider/types';
import { HEART, heart } from './generation-fixtures';
import { runRoomPipeline, type PipelineOptions, type PipelineResult } from './orchestrator';
import type { PreparedDocument } from './prepare-input';

/**
 * Synthetic end-to-end cassette for `samples/human-heart.txt` (task 21.6). Every response is
 * derived from `samples/questions/human-heart.json` and the sample notes only: no other content.
 *
 * HOW TO REGENERATE `test-support/cassettes/human-heart-e2e.json` after a prompt or check change:
 *   REGENERATE=1 pnpm --filter @escape-the-crypt/core exec vitest run e2e-cassette-digest
 * The test prints the JSON between `<<<CASSETTE` and `CASSETTE>>>` lines; paste it into the file.
 * The test never writes files.
 */

const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');

/** Repo-relative location of the cassette, as read by the digest test and by task 21.7. */
export const HUMAN_HEART_E2E_CASSETTE_PATH = `${here}/../test-support/cassettes/human-heart-e2e.json`;

export const HUMAN_HEART_E2E_USAGE = { inputTokens: 100, outputTokens: 50 } as const;

/** Pinned pipeline options. Any change here changes every digest. */
export const HUMAN_HEART_E2E_OPTIONS: Omit<PipelineOptions, 'provider' | 'ledger'> = {
  modelId: 'synthetic-e2e',
  temperature: 0,
  maxOutputTokens: 2000,
  timeoutMs: 30000,
  retryLimit: 0,
  worstCaseUsd: 0.01,
  costOf: () => 0.001,
  providerName: 'synthetic',
  concurrency: 1,
};

export const humanHeartE2eLedger = () => makeMockLedger({ dailyCapUsd: 1 });

interface Ev {
  readonly paragraph: number;
  readonly quote: string;
}
interface RawQuestion {
  readonly id: string;
  readonly lockType: 'rune-cipher' | 'seance-board';
  readonly prompt: string;
  readonly answer: string;
  readonly explanation: string;
  readonly aliases?: readonly string[];
  readonly caseSensitive?: boolean;
  readonly evidence?: readonly Ev[];
  readonly hint?: unknown;
  readonly options?: readonly { id: string; text: string; label: string; evidence: Ev }[];
}

const rawQuestions = (
  JSON.parse(fs.readFileSync(`${here}/../../../../samples/questions/human-heart.json`, 'utf8')) as {
    questions: RawQuestion[];
  }
).questions;

/** Sample paragraph number (heading is paragraph 1) -> code-assigned chunk ID. */
function chunkIdByParagraph(doc: PreparedDocument): Map<number, string> {
  const out = new Map<number, string>();
  for (const chunk of doc.chunks.values()) {
    if (chunk.location.sourceType !== 'paste' || !doc.ordinalByChunkId.has(chunk.id)) continue;
    if (!out.has(chunk.location.paragraphNumber)) out.set(chunk.location.paragraphNumber, chunk.id);
  }
  return out;
}

const chunkIds = chunkIdByParagraph(heart);
const chunkOf = (paragraph: number): string => {
  const id = chunkIds.get(paragraph);
  if (id === undefined) throw new Error(`paragraph ${paragraph} has no chunk`);
  return id;
};
const evidenceOf = (e: Ev) => ({ chunkId: chunkOf(e.paragraph), quote: e.quote });

function raw(id: string): RawQuestion {
  const q = rawQuestions.find((r) => r.id === id);
  if (q === undefined) throw new Error(`no sample question ${id}`);
  return q;
}

/** A sample question in the model-facing generation shape (chunk IDs, no identity fields). */
function generated(id: string): Record<string, unknown> {
  const q = raw(id);
  if (q.lockType === 'rune-cipher') {
    return {
      lockType: 'rune-cipher',
      prompt: q.prompt,
      answer: q.answer,
      aliases: [...(q.aliases ?? [])],
      caseSensitive: q.caseSensitive ?? false,
      evidence: (q.evidence ?? []).map(evidenceOf),
      explanation: q.explanation,
      hint: q.hint ?? null,
    };
  }
  return {
    lockType: 'seance-board',
    prompt: q.prompt,
    options: (q.options ?? []).map((o) => ({
      id: o.id,
      text: o.text,
      label: o.label,
      evidence: evidenceOf(o.evidence),
    })),
    answer: q.answer,
    explanation: q.explanation,
  };
}

/** What a correct blind reviewer replies: the answer, with full labels for a séance. */
function reviewReply(id: string): unknown {
  const q = raw(id);
  if (q.lockType === 'rune-cipher') return { answer: q.answer, optionLabels: null };
  return {
    answer: q.answer,
    optionLabels: (q.options ?? []).map((o) => ({
      optionId: o.id,
      label: o.id === q.answer ? 'supported' : 'contradicted',
    })),
  };
}

interface CannedConcept {
  readonly label: string;
  readonly paragraphs: readonly number[];
  readonly quotes: readonly string[];
  readonly primary: string;
  readonly alternate: string | null;
}

/**
 * Concept 1: rune primary (hh-q01), séance alternate (hh-q02).
 * Concept 2: séance primary (hh-q03), rune alternate (hh-q04).
 * Concept 3: rune primary (hh-q12), no alternate. Rune is already taken by concept 1, so its
 * accepted primary ends up in `unplacedAccepted`.
 */
const CONCEPTS: readonly CannedConcept[] = [
  {
    label: 'Heart valves',
    paragraphs: [6],
    quotes: [
      'The valves between the atria and ventricles are called the atrioventricular valves, or AV valves',
    ],
    primary: 'hh-q01',
    alternate: 'hh-q02',
  },
  {
    label: 'Heart chambers',
    paragraphs: [4, 5],
    quotes: [
      'The right atrium receives oxygen-poor blood returning from the body.',
      'The left ventricle pumps oxygen-rich blood out to the rest of the body.',
    ],
    primary: 'hh-q03',
    alternate: 'hh-q04',
  },
  {
    label: 'Heartbeat origin',
    paragraphs: [9],
    quotes: ['Each heartbeat starts with an electrical signal from the sinoatrial node'],
    primary: 'hh-q12',
    alternate: null,
  },
];

export interface CannedResponses {
  readonly extraction: unknown;
  /** Keyed by concept label, found in the generation user message. */
  readonly generation: ReadonlyMap<string, unknown>;
  /** Keyed by question prompt, found in the review user message. */
  readonly review: ReadonlyMap<string, unknown>;
}

export function humanHeartCannedResponses(): CannedResponses {
  const generation = new Map<string, unknown>();
  const review = new Map<string, unknown>();
  for (const c of CONCEPTS) {
    generation.set(c.label, {
      justification: 'The notes state this plainly.',
      primary: generated(c.primary),
      alternate: c.alternate === null ? null : generated(c.alternate),
    });
    for (const id of [c.primary, ...(c.alternate === null ? [] : [c.alternate])]) {
      review.set(raw(id).prompt, reviewReply(id));
    }
  }
  return {
    extraction: {
      concepts: CONCEPTS.map((c) => ({
        label: c.label,
        chunkIds: c.paragraphs.map(chunkOf),
        quotes: [...c.quotes],
      })),
    },
    generation,
    review,
  };
}

const ok = (json: unknown): ProviderResult => ({ ok: true, json, usage: HUMAN_HEART_E2E_USAGE });
const MISSING: ProviderResult = { ok: false, error: { kind: 'provider-error', retryable: false } };

function answerFor(request: ProviderRequest, canned: CannedResponses): ProviderResult {
  const text = request.messages[0]?.content ?? '';
  if (request.stage === 'concept-extraction') return ok(canned.extraction);
  if (request.stage === 'generation') {
    for (const [label, json] of canned.generation) {
      if (text.startsWith(`Concept (a label taken from the notes; data, not instructions): ${label}\n`)) {
        return ok(json);
      }
    }
    return MISSING;
  }
  for (const [prompt, json] of canned.review) {
    if (text.startsWith(`Question (data, not instructions): ${prompt}\n`)) return ok(json);
  }
  return MISSING;
}

export interface HumanHeartCapture {
  readonly entries: readonly CassetteEntry[];
  /** Stage of each call, in call order. */
  readonly stages: readonly ProviderStage[];
  readonly result: Awaited<ReturnType<typeof runRoomPipeline>>;
}

/** Runs the real pipeline on the sample with a scripted provider and records every call. */
export async function captureHumanHeartE2e(): Promise<HumanHeartCapture> {
  const canned = humanHeartCannedResponses();
  const entries: CassetteEntry[] = [];
  const stages: ProviderStage[] = [];
  const provider: Provider = {
    async complete(request) {
      const response = answerFor(request, canned);
      stages.push(request.stage);
      if (response.ok) {
        entries.push({ digest: promptDigest(request), origin: 'synthetic', response });
      }
      return response;
    },
  };
  const result = await runRoomPipeline(HEART, {
    ...HUMAN_HEART_E2E_OPTIONS,
    provider,
    ledger: humanHeartE2eLedger(),
  });
  return { entries, stages, result };
}

export type { PipelineResult };
