import { parseAuthoringQuestion } from '../authoring/parse';
import type { AuthoringQuestion } from '../authoring/schema';
import { makeMockLedger } from '../budget/mock-ledger';
import { makeCassetteProvider } from '../cassette/cassette-provider';
import type { CassetteOrigin } from '../cassette/types';
import { promptDigest } from '../provider/prompt-digest';
import type { Provider, ProviderRequest, ProviderResult } from '../provider/types';
import { blindReview, type BlindReviewOptions } from './blind-review';
import { MITRAL_QUOTE, RUNE_QUOTE, USAGE, heart, valvesId } from './generation-fixtures';
import { prepareDocument, type PreparedDocument } from './prepare-input';

const [fsName, urlName]: string[] = ['node:fs', 'node:url'];
const fs = (await import(fsName!)) as unknown as { readFileSync(p: string, enc: string): string };
const url = (await import(urlName!)) as unknown as { fileURLToPath(href: string): string };
const here = url
  .fileURLToPath((import.meta as unknown as { url: string }).url)
  .replace(/\\/g, '/')
  .replace(/\/[^/]*$/, '');
const repoRoot = `${here}/../../../..`;

export { heart };

export const REVIEW_OPTIONS: BlindReviewOptions = {
  modelId: 'test-model',
  maxOutputTokens: 500,
  timeoutMs: 5000,
  retryLimit: 2,
  worstCaseUsd: 0.01,
  costOf: () => 0.001,
};

export const reviewLedger = (refuseAfter?: number) =>
  makeMockLedger({ dailyCapUsd: 1, ...(refuseAfter === undefined ? {} : { refuseAfter }) });

export const ok = (json: unknown): ProviderResult => ({ ok: true, json, usage: USAGE });

function must(value: unknown): AuthoringQuestion {
  const parsed = parseAuthoringQuestion(value);
  if (!parsed.ok) throw new Error(`fixture question invalid at ${parsed.error.path}`);
  return parsed.value;
}

const ordinalOf = (id: string): number => {
  const n = heart.ordinalByChunkId.get(id);
  if (n === undefined) throw new Error('chunk is not quotable');
  return n;
};

/** hh-q01 in authoring form. Extra fields are sentinels the reviewer must never see. */
export function runeQuestion(over: Record<string, unknown> = {}): AuthoringQuestion {
  return must({
    id: 'rv-rune',
    conceptId: 'rv-c1',
    role: 'primary',
    lockType: 'rune-cipher',
    prompt:
      'According to your notes, the valves between the atria and ventricles are called the ______ valves.',
    answer: 'atrioventricular',
    aliases: ['AV-ALIAS-SENTINEL'],
    caseSensitive: false,
    evidence: [{ paragraph: ordinalOf(valvesId), quote: RUNE_QUOTE }],
    explanation: 'EXPLANATION-SENTINEL-7731',
    hint: { kind: 'first-letter-and-length', firstLetter: 'a', length: 16 },
    note: 'NOTE-SENTINEL-4412',
    ...over,
  });
}

export function seanceQuestion(over: Record<string, unknown> = {}): AuthoringQuestion {
  const paragraph = ordinalOf(valvesId);
  const ev = (quote: string) => ({ paragraph, quote });
  return must({
    id: 'rv-seance',
    conceptId: 'rv-c2',
    role: 'primary',
    lockType: 'seance-board',
    prompt: 'According to your notes, which atrioventricular valve is on the left side of the heart?',
    options: [
      { id: 'a', text: 'The tricuspid valve', label: 'contradicted', evidence: ev(MITRAL_QUOTE) },
      { id: 'b', text: 'The mitral valve', label: 'supported', evidence: ev(MITRAL_QUOTE) },
      {
        id: 'c',
        text: 'The aortic valve',
        label: 'contradicted',
        evidence: ev('The pulmonary valve and the aortic valve sit where blood leaves the ventricles.'),
      },
    ],
    answer: 'b',
    explanation: 'EXPLANATION-SENTINEL-7731',
    ...over,
  });
}

export const labels = (a: string, b: string, c: string) => ({
  answer: 'b',
  optionLabels: [
    { optionId: 'a', label: a },
    { optionId: 'b', label: b },
    { optionId: 'c', label: c },
  ],
});

/** A provider wrapper that records every request it receives. */
export function recording(inner: Provider): Provider & { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    complete(request) {
      requests.push(request);
      return inner.complete(request);
    },
  };
}

/** Replays the given results in order; the last one repeats. */
export function scripted(results: readonly ProviderResult[]): Provider & { requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      return results[Math.min(requests.length - 1, results.length - 1)]!;
    },
  };
}

/** The exact request `blindReview` builds for this question, captured with a failing provider. */
export async function requestFor(
  question: AuthoringQuestion,
  doc: PreparedDocument,
): Promise<ProviderRequest> {
  const probe = scripted([{ ok: false, error: { kind: 'provider-error', retryable: false } }]);
  await blindReview(probe, reviewLedger(), question, doc, REVIEW_OPTIONS);
  const request = probe.requests[0];
  if (!request) throw new Error('blindReview made no request (blocking check?)');
  return request;
}

/** One-entry cassette keyed by the real Prompt_Digest of this question's review request. */
export async function cassetteFor(
  question: AuthoringQuestion,
  doc: PreparedDocument,
  json: unknown,
  origin: CassetteOrigin = 'synthetic',
): Promise<Provider & { requests: ProviderRequest[] }> {
  const digest = promptDigest(await requestFor(question, doc));
  return recording(
    makeCassetteProvider({
      checkVersion: 'test',
      entries: [{ digest, origin, response: { ok: true, json, usage: USAGE } }],
    }),
  );
}

interface RawFixture {
  readonly id: string;
  readonly notes: string;
  readonly notesDir?: string;
  readonly expectedCatch: string;
  readonly question: {
    readonly lockType: string;
    readonly evidence?: readonly { paragraph: number; quote: string }[];
    readonly options?: readonly { evidence: { paragraph: number; quote: string } }[];
  };
}

export interface ReviewFixture {
  readonly id: string;
  readonly expectedCatch: string;
  readonly doc: PreparedDocument;
  readonly question: AuthoringQuestion;
  /** Fixture paragraph (heading counts as paragraph 1) -> pipeline ordinal (headings excluded). */
  readonly translated: readonly { readonly from: number; readonly to: number }[];
}

/** Paragraph number -> pipeline ordinal, via the first chunk of that paragraph (chunk ID). */
function paragraphToOrdinal(doc: PreparedDocument): Map<number, number> {
  const out = new Map<number, number>();
  for (const chunk of doc.chunks.values()) {
    if (chunk.location.sourceType !== 'paste') continue;
    const ordinal = doc.ordinalByChunkId.get(chunk.id);
    if (ordinal !== undefined && !out.has(chunk.location.paragraphNumber)) {
      out.set(chunk.location.paragraphNumber, ordinal);
    }
  }
  return out;
}

/** The rune and séance `review:*` adversarial fixtures, re-keyed to pipeline ordinals. */
export function loadReviewFixtures(
  lockTypes: readonly string[] = ['rune-cipher', 'seance-board'],
): readonly ReviewFixture[] {
  const raw = JSON.parse(
    fs.readFileSync(`${repoRoot}/eval/adversarial/fixtures.json`, 'utf8'),
  ) as { fixtures: RawFixture[] };
  return raw.fixtures
    .filter(
      (f) =>
        f.expectedCatch.startsWith('review:') &&
        lockTypes.includes(f.question.lockType),
    )
    .map((f) => {
      const dir =
        f.notesDir === 'adversarial/notes'
          ? 'eval/adversarial/notes'
          : f.notesDir === 'samples'
            ? 'samples'
            : 'eval/dev/notes';
      const doc = prepareDocument(fs.readFileSync(`${repoRoot}/${dir}/${f.notes}`, 'utf8'));
      const map = paragraphToOrdinal(doc);
      const translated: { from: number; to: number }[] = [];
      const remap = <T extends { paragraph: number }>(e: T): T => {
        const to = map.get(e.paragraph);
        if (to === undefined) throw new Error(`${f.id}: paragraph ${e.paragraph} has no chunk`);
        translated.push({ from: e.paragraph, to });
        return { ...e, paragraph: to };
      };
      const q = JSON.parse(JSON.stringify(f.question)) as Record<string, unknown> & {
        evidence?: { paragraph: number }[];
        options?: { evidence: { paragraph: number } }[];
        pairs?: { evidence: { paragraph: number } }[];
      };
      if (q.evidence) q.evidence = q.evidence.map(remap);
      if (q.options) q.options = q.options.map((o) => ({ ...o, evidence: remap(o.evidence) }));
      if (q.pairs) q.pairs = q.pairs.map((p) => ({ ...p, evidence: remap(p.evidence) }));
      return { id: f.id, expectedCatch: f.expectedCatch, doc, question: must(q), translated };
    });
}
